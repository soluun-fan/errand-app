/**
 * The deal engine: one state machine for errands and SafePay goods deals.
 *
 * Pure: no I/O, no clock, no randomness. Every function takes the current deal plus a context
 * (time + who is acting) and returns a *new* deal together with the timeline events, ledger
 * entries and side effects the caller must persist — ideally in one DB transaction, using
 * `deal.version` for optimistic locking.
 *
 * Illegal transitions throw `EngineError`; they never partially apply.
 */
import { DEFAULT_CONFIG, HOUR_MS, MINUTE_MS, TWO_POINT_CATEGORIES, categoryConfig, categoryTrust, type CategoryId, type EngineConfig } from "./config";
import { EngineError, assertMoney, fail } from "./errors";
import { roadKm } from "./geo";
import { ext, payable } from "./ledger";
import { amountDue, buyerFeeFor, careTimeOk, errandSplit, heldItemBudget, minFeeAt, quoteFee, serviceFeeFor, taskMinFee } from "./money";
import { DEFAULT_DETAILS, LANGUAGES, type ErrandDetails, type GeoPoint, type HelperBadges, type Invite, type Language, type PriceChange, type TaskConditions, type TaskRules } from "./types";
import type {
  Account,
  Command,
  Ctx,
  Deal,
  DealStatus,
  Effect,
  ErrandDeal,
  GoodsDeal,
  LedgerEntry,
  LedgerKind,
  Mode,
  TimelineEvent,
  Transition,
  UserActor,
} from "./types";

/* ---------- transaction builder ---------- */

class Tx<D extends Deal> {
  readonly d: D;
  readonly events: TimelineEvent[] = [];
  readonly ledger: LedgerEntry[] = [];
  readonly effects: Effect[] = [];

  constructor(deal: D, readonly ctx: Ctx) {
    this.d = structuredClone(deal);
  }

  ev(code: string, data: Record<string, string | number> = {}): void {
    this.events.push({ dealId: this.d.id, code, data, at: this.ctx.now });
  }

  payIn(amount: number, payerId: string, providerRef: string): void {
    this.d.heldAmount += amount;
    this.d.providerRefs = [...this.d.providerRefs, providerRef];
    this.ledger.push({ dealId: this.d.id, kind: "pay_in", amount, from: ext(payerId), to: "hold", providerRef, at: this.ctx.now });
  }

  /** Moves money out of this deal's hold. Zero amounts are skipped. */
  fromHold(kind: LedgerKind, amount: number, to: Account): void {
    if (amount === 0) return;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.d.heldAmount) {
      fail("INVARIANT_BROKEN", `Cannot move ${amount} out of hold; deal ${this.d.id} holds ${this.d.heldAmount}`);
    }
    this.d.heldAmount -= amount;
    this.ledger.push({ dealId: this.d.id, kind, amount, from: "hold", to, providerRef: null, at: this.ctx.now });
  }

  done(): Transition<D> {
    this.d.version += 1;
    return { deal: this.d, events: this.events, ledger: this.ledger, effects: this.effects, duplicate: false };
  }
}

const noop = <D extends Deal>(deal: D): Transition<D> => ({ deal, events: [], ledger: [], effects: [], duplicate: true });

/* ---------- guards ---------- */

function requireStatus(d: Deal, cmd: string, ...allowed: DealStatus[]): void {
  if (!allowed.includes(d.status)) {
    fail("ILLEGAL_TRANSITION", `Cannot ${cmd} a ${d.type} deal in status "${d.status}"`);
  }
}

function requireUser(ctx: Ctx): UserActor {
  if (ctx.actor.kind !== "user") fail("FORBIDDEN", "This action needs a signed-in user");
  return ctx.actor as UserActor;
}

function requireKind(ctx: Ctx, kind: "provider" | "system", cmd: string): void {
  if (ctx.actor.kind !== kind) fail("FORBIDDEN", `${cmd} can only be triggered by the ${kind}`);
}

function payerOf(d: Deal): string | null {
  return d.type === "errand" ? d.customerId : d.buyerId;
}

function requirePayer(ctx: Ctx, d: Deal): UserActor {
  const u = requireUser(ctx);
  if (u.id !== payerOf(d)) fail("FORBIDDEN", "Only the paying customer/buyer can do this");
  return u;
}

function requireAssignedHelper(ctx: Ctx, d: ErrandDeal): UserActor {
  const u = requireUser(ctx);
  if (d.helperId === null || u.id !== d.helperId) fail("FORBIDDEN", "Only the assigned helper can do this");
  return u;
}

function requireEligibleHelper(ctx: Ctx, d: ErrandDeal): UserActor {
  const u = requireUser(ctx);
  if (u.role !== "helper" || !u.helperApproved) fail("FORBIDDEN", "Only approved helpers can take tasks");
  const trust = categoryTrust(d.category);
  if (trust === "open") {
    if (!u.categories?.includes(d.category)) fail("FORBIDDEN", `Helper does not work in category "${d.category}"`);
  } else if (!(u.qualified ?? []).some((q) => q.category === d.category)) {
    // specialized work: a certificate or an organisation (docs/decisions.md 2026-11-16); care: an agency
    // or an individual care clearance, both only with the background check (2026-11-17) — the server
    // works out `qualified` with those rules, the database checks them again
    fail("FORBIDDEN", trust === "care" ? "Only background-checked helpers cleared for care work can take this task" : "This kind of task needs a checked certificate or an approved organisation");
  }
  if (u.id === d.customerId) fail("FORBIDDEN", "You cannot take your own task");
  const missing = missingConditions(d.details.require, u.badges);
  if (missing.length) fail("FORBIDDEN", `This task needs: ${missing.join(", ")}`);
  return u;
}

/** Which of a task's conditions the helper doesn't meet (same rule as private.meets_conditions). */
export function missingConditions(req: TaskConditions | undefined, b: HelperBadges | undefined): (keyof TaskConditions)[] {
  if (!req) return [];
  const out: (keyof TaskConditions)[] = [];
  if (req.driver && !b?.driver) out.push("driver");
  if (req.car && !b?.car) out.push("car");
  if (req.checked && !b?.checked) out.push("checked");
  if (req.onTime && !(b?.onTimeOk ?? true)) out.push("onTime");
  if (req.language && !b?.languages.includes(req.language)) out.push("language");
  return out;
}

/** A task's conditions as given by the client: only known keys, only true flags, a known language. */
function cleanConditions(raw: unknown): TaskConditions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const c: TaskConditions = {};
  for (const k of ["driver", "car", "checked", "onTime", "call", "handoverCode"] as const) if (r[k] === true) c[k] = true;
  if (typeof r.language === "string" && (LANGUAGES as readonly string[]).includes(r.language)) c.language = r.language as Language;
  return Object.keys(c).length ? c : undefined;
}

/** Through whom the helper takes specialized work: the organisation that vouches for them, else themselves (null). */
function orgFor(u: UserActor, category: CategoryId): string | null {
  if (categoryTrust(category) === "open") return null;
  return (u.qualified ?? []).find((q) => q.category === category && q.orgId !== null)?.orgId ?? null;
}

function asErrand(d: Deal, cmd: string): ErrandDeal {
  if (d.type !== "errand") fail("ILLEGAL_TRANSITION", `${cmd} only applies to errands`);
  return d as ErrandDeal;
}

function asGoods(d: Deal, cmd: string): GoodsDeal {
  if (d.type !== "goods") fail("ILLEGAL_TRANSITION", `${cmd} only applies to SafePay deals`);
  return d as GoodsDeal;
}

/* ---------- money moves shared by several transitions ---------- */

function refundAll(tx: Tx<Deal>, reason: string): void {
  const payer = payerOf(tx.d);
  const amount = tx.d.heldAmount;
  if (amount > 0) {
    if (payer === null) fail("INVARIANT_BROKEN", `Deal ${tx.d.id} holds money but has no payer`);
    tx.fromHold("refund", amount, ext(payer as string));
    tx.ev("refunded", { amount, reason });
  }
}

function release(tx: Tx<Deal>, how: "confirmed" | "auto" | "ops"): void {
  const d = tx.d;
  if (d.type === "errand" && d.payMode === "direct") {
    // only our fee was held: it becomes ours; the helper was paid by the customer directly
    if (d.helperId === null) fail("INVARIANT_BROKEN", `Errand ${d.id} has no helper`);
    if (d.heldAmount !== d.serviceFee) fail("INVARIANT_BROKEN", `Errand ${d.id}: fee ${d.serviceFee} != held ${d.heldAmount}`);
    tx.fromHold("platform_fee", d.heldAmount, "platform");
    tx.ev("released", { how, helperNet: 0, refund: 0, platform: d.serviceFee, direct: 1 });
  } else if (d.type === "errand") {
    if (d.helperId === null) fail("INVARIANT_BROKEN", `Errand ${d.id} has no helper to release to`);
    const s = errandSplit({
      fee: d.fee,
      itemBudget: d.itemBudget,
      receipt: d.receiptAmount,
      serviceFee: d.serviceFee,
      commissionBps: d.commissionBps,
    });
    if (s.held !== d.heldAmount) fail("INVARIANT_BROKEN", `Errand ${d.id}: split total ${s.held} != held ${d.heldAmount}`);
    // an organisation's worker: the organisation is paid (it pays its staff and answers for the work)
    const helper = payable(d.payeeOrgId ?? (d.helperId as string));
    tx.fromHold("release_fee", s.helperFeeNet, helper);
    tx.fromHold("item_reimburse", s.spent, helper);
    tx.fromHold("budget_refund", s.refund, ext(d.customerId));
    tx.fromHold("platform_fee", s.platform, "platform");
    tx.ev("released", { how, helperNet: s.helperNet, refund: s.refund, platform: s.platform });
  } else {
    if (d.price + d.buyerFee !== d.heldAmount) {
      fail("INVARIANT_BROKEN", `SafePay ${d.id}: price+fee ${d.price + d.buyerFee} != held ${d.heldAmount}`);
    }
    tx.fromHold("release_seller", d.price, payable(d.sellerId));
    tx.fromHold("platform_fee", d.buyerFee, "platform");
    tx.ev("released", { how, sellerNet: d.price, platform: d.buyerFee });
  }
  if (d.heldAmount !== 0) fail("INVARIANT_BROKEN", `Deal ${d.id} still holds ${d.heldAmount} after release`);
  d.status = "released";
}

/* ---------- creation ---------- */

export interface NewErrandInput {
  id: string;
  title: string;
  description: string;
  category: CategoryId;
  mode: Mode;
  scheduledAt?: number | null;
  pickupAddress?: string | null;
  /** Pickup pin; with `location` the engine measures the distance itself. */
  pickupLocation?: GeoPoint | null;
  address: string;
  location?: GeoPoint | null;
  itemBudget: number;
  fee: number;
  customerId: string;
  details?: Partial<ErrandDetails>;
  /** Send it to one helper first (from their profile). The app checks they are approved and do this kind of task. */
  invite?: { helperId: string; openAfter: boolean } | null;
}

/** Rough Mongolia bounding box: catches swapped lat/lng and junk pins. */
function validLocation(p: GeoPoint | null | undefined): GeoPoint | null {
  if (p === null || p === undefined) return null;
  const ok = Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= 41.5 && p.lat <= 52.2 && p.lng >= 87.7 && p.lng <= 120;
  if (!ok) fail("INVALID_INPUT", "Pin must be inside Mongolia");
  return { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
}

const clean = (s: string | null | undefined, max = 200) => {
  const v = (s ?? "").trim().slice(0, max);
  return v === "" ? null : v;
};

function normalizeDetails(raw: Partial<ErrandDetails> | undefined): ErrandDetails {
  const d = { ...DEFAULT_DETAILS, ...raw };
  if (!Number.isFinite(d.km) || d.km < 0 || d.km > 100) fail("INVALID_INPUT", "Distance must be between 0 and 100 km");
  if (d.floor !== null && (!Number.isInteger(d.floor) || d.floor < 0 || d.floor > 60)) fail("INVALID_INPUT", "Floor must be 0–60");
  if (d.lift !== null && !["yes", "no", "unknown"].includes(d.lift)) fail("INVALID_INPUT", "Bad lift value");
  if (d.people !== 1 && d.people !== 2) fail("INVALID_INPUT", "People must be 1 or 2");
  if (!Number.isInteger(d.minutes) || d.minutes < 30 || d.minutes > 480 || d.minutes % 30 !== 0) {
    fail("INVALID_INPUT", "Duration must be 30 minutes to 8 hours, in 30-minute steps");
  }
  return {
    km: d.km,
    entrance: clean(d.entrance, 20),
    floor: d.floor,
    unit: clean(d.unit, 20),
    lift: d.lift,
    note: clean(d.note, 300),
    people: d.people,
    carryByHelper: Boolean(d.carryByHelper),
    heavy: Boolean(d.heavy),
    roundTrip: Boolean(d.roundTrip) && d.km > 0,
    budgetBuffer: Boolean(d.budgetBuffer),
    autoPick: Boolean(d.autoPick),
    minutes: d.minutes,
    tools: Boolean(d.tools),
    // set below by createErrand, never taken from the client
    quotedFee: 0,
    counterMax: 0,
    require: cleanConditions(d.require),
  };
}

export function createErrand(input: NewErrandInput, ctx: Ctx, cfg: EngineConfig = DEFAULT_CONFIG): Transition<ErrandDeal> {
  const u = requireUser(ctx);
  if (u.id !== input.customerId) fail("FORBIDDEN", "You can only post tasks as yourself");
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title) fail("INVALID_INPUT", "Title is required");
  if (title.length > cfg.titleMax) fail("INVALID_INPUT", `Title is longer than ${cfg.titleMax} characters`);
  if (description.length > cfg.descriptionMax) {
    fail("INVALID_INPUT", `Description is longer than ${cfg.descriptionMax} characters`);
  }
  if (!input.address.trim()) fail("INVALID_INPUT", "Address is required");
  assertMoney(input.fee, "fee");
  assertMoney(input.itemBudget, "itemBudget");
  // Timing is independent of the matching mode (docs/rules.md §Modes).
  const scheduledAt = input.scheduledAt ?? null;
  if (scheduledAt !== null && scheduledAt <= ctx.now) fail("INVALID_INPUT", "Scheduled time must be in the future");
  const location = validLocation(input.location);
  const pickupLocation = TWO_POINT_CATEGORIES.includes(input.category) ? validLocation(input.pickupLocation) : null;
  // Both pins: the distance comes from the map, never from the client's number.
  const details = normalizeDetails(
    location && pickupLocation ? { ...input.details, km: roadKm(pickupLocation, location) } : input.details,
  );
  const startsAt = scheduledAt ?? ctx.now;
  if (categoryTrust(input.category) === "care" && !careTimeOk(startsAt, details.minutes, cfg)) {
    fail("INVALID_INPUT", `Care work is daytime only (${cfg.careDayStartHour}:00–${cfg.careDayEndHour}:00) and up to ${cfg.careMaxMinutes / 60} hours`);
  }
  const quote = quoteFee(input.category, details, cfg, startsAt);
  if (details.people < quote.peopleRequired) fail("INVALID_INPUT", "This task needs 2 people");
  // The customer names the price; we only set the floor (docs/decisions.md 2026-11-16 "Bargaining").
  const min = taskMinFee(input.category, details, startsAt, cfg);
  if (input.fee < min) fail("INVALID_INPUT", `Minimum fee is ₮${min}`);
  details.minFee = min; // later prices (counters, changes) are checked against this, not today's settings
  details.rules = {
    paymentWindowMinutes: cfg.paymentWindowMinutes,
    backOutGraceMinutes: cfg.backOutGraceMinutes,
    rematchWindowMinutes: cfg.nowMatchWindowMinutes,
    applicationMinutes: cfg.applicationMinutes,
    autoPickMinutes: cfg.autoPickMinutes,
  };
  details.quotedFee = quote.total; // kept for learning what people pay; not shown as "the price"
  details.counterMax = 0;
  // care work: the customer always chooses the person themselves
  if (categoryTrust(input.category) === "care") details.autoPick = false;
  if (input.itemBudget === 0) details.budgetBuffer = false;
  // `itemBudget` is what the customer typed; the deal holds it plus the optional buffer.
  const itemBudget = heldItemBudget(input.itemBudget, details.budgetBuffer, cfg);

  const matchWindowMinutes = input.mode === "now" ? cfg.nowMatchWindowMinutes : cfg.scheduleMatchWindowMinutes;
  const matchBy = scheduledAt ?? ctx.now + matchWindowMinutes * MINUTE_MS;
  let invite: Invite | null = null;
  if (input.invite) {
    const helperId = input.invite.helperId.trim();
    if (!helperId) fail("INVALID_INPUT", "Invited helper is required");
    if (helperId === input.customerId) fail("INVALID_INPUT", "You cannot send a request to yourself");
    const openAfter = Boolean(input.invite.openAfter);
    const minutes = scheduledAt === null ? cfg.inviteMinutes : cfg.inviteMinutesScheduled;
    invite = { helperId, openAfter, until: openAfter ? Math.min(matchBy, ctx.now + minutes * MINUTE_MS) : matchBy };
  }
  // Posting is free: the task goes straight to helpers; the customer pays once someone is matched.
  const deal: ErrandDeal = {
    id: input.id,
    version: 0,
    type: "errand",
    status: "open",
    title,
    description,
    category: input.category,
    mode: input.mode,
    scheduledAt,
    pickupAddress: input.pickupAddress?.trim() || null,
    address: input.address.trim(),
    pickupLocation,
    location,
    payBy: null,
    assignedAt: null,
    details,
    itemBudget,
    fee: input.fee,
    postedFee: input.fee,
    // fixed at posting from the posted price; a counter-offer doesn't change it
    serviceFee: serviceFeeFor(input.fee, cfg),
    commissionBps: cfg.commissionBps,
    payMode: cfg.payMode,
    cancelFee: cfg.cancelFee,
    maxApplicants: cfg.maxApplicants,
    matchWindowMinutes,
    customerId: input.customerId,
    helperId: null,
    offers: [],
    matchBy,
    receiptAmount: null,
    topUp: null,
    priceChange: null,
    invite,
    payeeOrgId: null,
    handoverProofAt: null,
    heldAmount: 0,
    paymentRef: null,
    providerRefs: [],
    checkHours: categoryConfig(input.category).checkHours ?? cfg.errandCheckHours,
    checkUntil: null,
    dispute: null,
    createdAt: ctx.now,
  };
  return {
    deal,
    events: [
      { dealId: deal.id, code: "posted", data: { amountDue: amountDue(deal) }, at: ctx.now },
      invite
        ? { dealId: deal.id, code: "invite_sent", data: { helperId: invite.helperId, open: invite.openAfter ? 1 : 0 }, at: ctx.now }
        : { dealId: deal.id, code: "helpers_notified", data: { mode: deal.mode }, at: ctx.now },
    ],
    ledger: [],
    effects: [],
    duplicate: false,
  };
}

/** A timing this task runs by: copied at posting (`details.rules`); older tasks use the engine default. */
export function ruleOf(e: ErrandDeal, key: keyof TaskRules): number {
  const v = e.details.rules?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const fallback: TaskRules = {
    paymentWindowMinutes: DEFAULT_CONFIG.paymentWindowMinutes,
    backOutGraceMinutes: DEFAULT_CONFIG.backOutGraceMinutes,
    rematchWindowMinutes: DEFAULT_CONFIG.nowMatchWindowMinutes,
    applicationMinutes: DEFAULT_CONFIG.applicationMinutes,
    autoPickMinutes: DEFAULT_CONFIG.autoPickMinutes,
  };
  return fallback[key];
}

/**
 * A helper is assigned: the customer now has the payment window to pay (the bank holds it).
 * Legacy deals that were paid at posting go straight to "matched".
 */
function assignHelper(tx: Tx<Deal>, e: ErrandDeal, helperId: string, fee: number, orgId: string | null): void {
  e.helperId = helperId;
  e.payeeOrgId = orgId;
  e.assignedAt = tx.ctx.now;
  if (e.heldAmount > 0) {
    e.status = "matched";
    return;
  }
  e.fee = fee;
  e.status = "awaiting_payment";
  e.payBy = tx.ctx.now + ruleOf(e, "paymentWindowMinutes") * MINUTE_MS;
}

/** A price either side may name: a whole tögrög amount, at least today's minimum. */
function checkPrice(e: ErrandDeal, price: number, now: number): void {
  assertMoney(price, "price");
  const min = e.details.minFee && e.details.minFee > 0 ? e.details.minFee : minFeeAt(e.scheduledAt ?? now);
  if (price < min) fail("INVALID_INPUT", `Minimum fee is ₮${min}`);
}

/** Applications still standing: on Instant tasks they lapse after `applicationMinutes`. */
export function liveOffers(e: ErrandDeal, now: number): ErrandDeal["offers"] {
  if (e.mode !== "now") return e.offers;
  return e.offers.filter((o) => now - o.at < ruleOf(e, "applicationMinutes") * MINUTE_MS);
}

/** When "Choose for me" may pick (first live application + autoPickMinutes), or null. */
export function autoPickAt(e: ErrandDeal, now: number): number | null {
  if (categoryTrust(e.category) === "care" || !e.details.autoPick || e.status !== "open") return null;
  const live = liveOffers(e, now);
  if (!live.length) return null;
  return Math.min(...live.map((o) => o.at)) + ruleOf(e, "autoPickMinutes") * MINUTE_MS;
}

/**
 * Who alone may apply right now because of a direct request, or null when anyone may. A request
 * that may open stops being exclusive at `invite.until`; one that may not stays exclusive.
 */
export function invitedOnly(e: ErrandDeal, now: number): string | null {
  if (!e.invite) return null;
  return !e.invite.openAfter || now < e.invite.until ? e.invite.helperId : null;
}

function requireInvited(e: ErrandDeal, helperId: string, now: number): void {
  const only = invitedOnly(e, now);
  if (only !== null && only !== helperId) fail("FORBIDDEN", "This task was sent to one helper first");
}

/** The match lapsed before payment (timeout or helper withdrew): back to searching. */
function unassignHelper(e: ErrandDeal): void {
  e.helperId = null;
  e.payeeOrgId = null;
  e.payBy = null;
  e.assignedAt = null;
  e.fee = e.postedFee;
  e.status = "open";
}

export interface NewGoodsInput {
  id: string;
  title: string;
  description?: string;
  price: number;
  checkHours: number;
  sellerId: string;
  /** From `generateDealCode()`; uniqueness is the caller's job (DB unique index). */
  code: string;
}

export const DEAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no 0/O/1/I
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}$/;

export function createGoods(input: NewGoodsInput, ctx: Ctx, cfg: EngineConfig = DEFAULT_CONFIG): Transition<GoodsDeal> {
  const u = requireUser(ctx);
  if (u.id !== input.sellerId) fail("FORBIDDEN", "You can only create deals as yourself");
  if (!input.title.trim()) fail("INVALID_INPUT", "Item title is required");
  assertMoney(input.price, "price");
  if (input.price < 1000) fail("INVALID_INPUT", "Price must be at least ₮1,000");
  if (!cfg.goodsCheckHours.includes(input.checkHours)) {
    fail("INVALID_INPUT", `Check window must be one of ${cfg.goodsCheckHours.join(", ")} hours`);
  }
  if (!CODE_RE.test(input.code)) fail("INVALID_INPUT", "Deal code must be 6 characters from the code alphabet");

  const deal: GoodsDeal = {
    id: input.id,
    version: 0,
    type: "goods",
    status: "awaiting_payment",
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    price: input.price,
    buyerFee: buyerFeeFor(input.price, cfg),
    sellerId: input.sellerId,
    buyerId: null,
    code: input.code,
    handedOverAt: null,
    heldAmount: 0,
    paymentRef: null,
    providerRefs: [],
    checkHours: input.checkHours,
    checkUntil: null,
    dispute: null,
    createdAt: ctx.now,
  };
  return {
    deal,
    events: [{ dealId: deal.id, code: "goods_created", data: { code: deal.code }, at: ctx.now }],
    ledger: [],
    effects: [],
    duplicate: false,
  };
}

/** Random 6-char deal code. Not pure (uses crypto); kept here so the alphabet lives in one place. */
export function generateDealCode(randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  // 256 is a multiple of 32, so `byte % 32` is unbiased.
  return Array.from(randomBytes(6), (b) => DEAL_CODE_ALPHABET[b % DEAL_CODE_ALPHABET.length]).join("");
}

/* ---------- the state machine ---------- */

export function apply<D extends Deal>(deal: D, cmd: Command, ctx: Ctx): Transition<D>;
export function apply(deal: Deal, cmd: Command, ctx: Ctx): Transition {
  // Idempotent webhook: the same provider event replayed is a no-op, whatever the deal's status now.
  if (cmd.type === "confirm_payment" && deal.paymentRef !== null && deal.paymentRef === cmd.providerRef) {
    requireKind(ctx, "provider", "Payment confirmation");
    return noop(deal);
  }
  // Same for a replayed top-up webhook.
  if (cmd.type === "confirm_topup" && deal.type === "errand" && deal.topUp?.providerRef === cmd.providerRef) {
    requireKind(ctx, "provider", "Top-up confirmation");
    return noop(deal);
  }
  // And for a replayed "price change paid" webhook.
  if (cmd.type === "confirm_price" && deal.type === "errand" && deal.priceChange?.providerRef === cmd.providerRef) {
    requireKind(ctx, "provider", "Price change confirmation");
    return noop(deal);
  }
  // Any payment webhook whose reference this deal already booked (e.g. an earlier price change's
  // extra payment replayed after a newer one was agreed) is a duplicate, never a second pay-in.
  if (
    (cmd.type === "confirm_payment" || cmd.type === "confirm_topup" || cmd.type === "confirm_price") &&
    (deal.providerRefs ?? []).includes(cmd.providerRef)
  ) {
    requireKind(ctx, "provider", "Payment confirmation");
    return noop(deal);
  }
  // A buyer re-opening a deal they already claimed is also a no-op.
  if (cmd.type === "claim" && deal.type === "goods" && ctx.actor.kind === "user" && deal.buyerId === ctx.actor.id) {
    return noop(deal);
  }

  const tx = new Tx(deal, ctx);
  const d = tx.d;

  switch (cmd.type) {
    case "confirm_payment": {
      requireKind(ctx, "provider", "Payment confirmation");
      // If this throws for a deal that was cancelled meanwhile, the caller must refund via the provider.
      requireStatus(d, "confirm payment for", "awaiting_payment");
      assertMoney(cmd.amount, "amount");
      if (!cmd.providerRef) fail("INVALID_INPUT", "providerRef is required");
      const due = amountDue(d);
      if (cmd.amount !== due) fail("PAYMENT_MISMATCH", `Expected ₮${due}, provider confirmed ₮${cmd.amount}`);
      const payer = payerOf(d);
      if (payer === null) fail("ILLEGAL_TRANSITION", "No buyer has opened this deal yet");
      tx.payIn(cmd.amount, payer as string, cmd.providerRef);
      d.paymentRef = cmd.providerRef;
      tx.ev("paid", d.type === "errand" && d.payMode === "direct" ? { amount: cmd.amount, direct: 1 } : { amount: cmd.amount });
      if (d.type === "errand") {
        if (d.helperId === null) fail("INVARIANT_BROKEN", `Errand ${d.id} awaiting payment without a helper`);
        d.status = "matched";
        d.payBy = null;
      } else {
        d.status = "held";
      }
      break;
    }

    case "claim": {
      const g = asGoods(d, "claim");
      const u = requireUser(ctx);
      requireStatus(g, "claim", "awaiting_payment");
      if (u.id === g.sellerId) fail("FORBIDDEN", "That is your own deal");
      if (g.buyerId !== null) fail("FORBIDDEN", "This deal already has a buyer");
      g.buyerId = u.id;
      tx.ev("buyer_joined", { buyerId: u.id });
      break;
    }

    case "accept": {
      const e = asErrand(d, "accept");
      const u = requireEligibleHelper(ctx, e);
      requireStatus(e, "accept", "open");
      if (e.mode !== "now") fail("ILLEGAL_TRANSITION", "Scheduled tasks take applications, not instant accepts");
      if (categoryTrust(e.category) === "care") fail("ILLEGAL_TRANSITION", "The customer chooses who does this task");
      requireInvited(e, u.id, ctx.now);
      assignHelper(tx, e, u.id, e.postedFee, orgFor(u, e.category));
      tx.ev("accepted", { helperId: u.id });
      break;
    }

    case "apply": {
      const e = asErrand(d, "apply");
      const u = requireEligibleHelper(ctx, e);
      requireStatus(e, "apply to", "open");
      requireInvited(e, u.id, ctx.now);
      // Both kinds take applications and the customer chooses (docs/decisions.md 2026-11-13).
      e.offers = liveOffers(e, ctx.now); // lapsed Instant applications drop out (and may re-apply)
      if (e.offers.some((o) => o.helperId === u.id)) fail("INVALID_INPUT", "You already applied");
      if (e.offers.length >= e.maxApplicants) fail("ILLEGAL_TRANSITION", `Task already has ${e.maxApplicants} applicants`);
      // Take the customer's price, or name your own — bargaining is open both ways (no cap).
      let price = cmd.price ?? null;
      if (price !== null) {
        checkPrice(e, price, ctx.now);
        if (price === e.postedFee) price = null;
      }
      e.offers.push({ helperId: u.id, orgId: orgFor(u, e.category), note: cmd.note.trim().slice(0, 300), price, proposedBy: "helper", at: ctx.now });
      tx.ev("applied", price === null ? { helperId: u.id } : { helperId: u.id, price });
      break;
    }

    case "reprice": {
      const e = asErrand(d, "reprice an offer on");
      const u = requireUser(ctx);
      requireStatus(e, "reprice an offer on", "open");
      const offer = e.offers.find((o) => o.helperId === u.id) ?? fail("INVALID_INPUT", "No application to change");
      checkPrice(e, cmd.price, ctx.now);
      offer.price = cmd.price === e.postedFee ? null : cmd.price;
      offer.proposedBy = "helper";
      offer.at = ctx.now; // a fresh answer keeps the application alive
      tx.ev("offer_priced", { helperId: u.id, price: cmd.price, by: "helper" });
      break;
    }

    case "counter": {
      const e = asErrand(d, "answer an offer on");
      requirePayer(ctx, e);
      requireStatus(e, "answer an offer on", "open");
      e.offers = liveOffers(e, ctx.now);
      const offer = e.offers.find((o) => o.helperId === cmd.helperId) ?? fail("INVALID_INPUT", "That helper did not apply, or their application lapsed");
      checkPrice(e, cmd.price, ctx.now);
      offer.price = cmd.price;
      offer.proposedBy = "customer";
      offer.at = ctx.now;
      tx.ev("offer_priced", { helperId: cmd.helperId, price: cmd.price, by: "customer" });
      break;
    }

    case "accept_counter": {
      const e = asErrand(d, "accept a price on");
      const u = requireEligibleHelper(ctx, e);
      requireStatus(e, "accept a price on", "open");
      const offer = e.offers.find((o) => o.helperId === u.id) ?? fail("INVALID_INPUT", "No application to accept on");
      if (offer.proposedBy !== "customer" || offer.price === null) fail("ILLEGAL_TRANSITION", "The customer hasn't named a price to accept");
      // Keep the organisation named in the offer, even if another membership was added later.
      if (categoryTrust(e.category) !== "open" && !u.qualified?.some((q) => q.category === e.category && q.orgId === offer.orgId)) {
        fail("FORBIDDEN", "The qualification used for this offer is no longer available");
      }
      if (categoryTrust(e.category) === "care") {
        // A price agreement is still subject to the customer's final choice of caregiver.
        offer.proposedBy = "helper";
        offer.at = ctx.now;
        tx.ev("offer_priced", { helperId: u.id, price: offer.price as number, by: "helper" });
      } else {
        assignHelper(tx, e, u.id, offer.price as number, offer.orgId);
        tx.ev("chosen", { helperId: u.id, fee: e.fee, by: "helper_accepted" });
      }
      break;
    }

    case "set_price": {
      const e = asErrand(d, "change the price of");
      requirePayer(ctx, e);
      requireStatus(e, "change the price of", "open");
      checkPrice(e, cmd.price, ctx.now);
      if (cmd.price === e.postedFee) return noop(deal);
      // Helpers who took the old price keep exactly what they agreed to.
      for (const o of e.offers) if (o.price === null) o.price = e.postedFee;
      for (const o of e.offers) if (o.price === cmd.price && o.proposedBy === "helper") o.price = null;
      const from = e.postedFee;
      e.postedFee = cmd.price;
      e.fee = cmd.price;
      tx.ev("price_changed", { from, to: cmd.price });
      break;
    }

    case "decline_invite": {
      const e = asErrand(d, "decline a request on");
      const u = requireUser(ctx);
      requireStatus(e, "decline a request on", "open");
      if (!e.invite || e.invite.helperId !== u.id || invitedOnly(e, ctx.now) === null) fail("FORBIDDEN", "There is no request to you waiting on this task");
      const inv = e.invite as Invite;
      e.offers = e.offers.filter((o) => o.helperId !== u.id);
      if (inv.openAfter) {
        inv.until = ctx.now; // everyone may apply from now on
        tx.ev("invite_declined", { helperId: u.id, open: 1 });
      } else {
        e.status = "expired"; // the customer wanted only this helper; nothing is held while open
        tx.ev("invite_declined", { helperId: u.id, open: 0 });
      }
      break;
    }

    case "open_to_all": {
      const e = asErrand(d, "open");
      requirePayer(ctx, e);
      requireStatus(e, "open", "open");
      if (invitedOnly(e, ctx.now) === null) return noop(deal);
      const inv = e.invite as Invite;
      inv.openAfter = true;
      inv.until = ctx.now;
      tx.ev("invite_opened", { helperId: inv.helperId });
      break;
    }

    case "choose": {
      const e = asErrand(d, "choose");
      requireStatus(e, "choose a helper for", "open");
      if (ctx.actor.kind === "system") {
        const at = autoPickAt(e, ctx.now);
        if (at === null || ctx.now < at) fail("ILLEGAL_TRANSITION", "Auto-pick is off or not due yet");
      } else {
        requirePayer(ctx, e);
      }
      e.offers = liveOffers(e, ctx.now);
      const offer = e.offers.find((o) => o.helperId === cmd.helperId);
      if (!offer) fail("INVALID_INPUT", "That helper did not apply, or their application lapsed");
      // The customer's own counter needs the helper's yes first (accept_counter), not a self-accept.
      if ((offer as NonNullable<typeof offer>).proposedBy === "customer") fail("ILLEGAL_TRANSITION", "Waiting for the helper to answer your price");
      const fee = (offer as NonNullable<typeof offer>).price ?? e.postedFee;
      // the organisation they applied through is paid (the database re-checks they still belong to it)
      assignHelper(tx, e, cmd.helperId, fee, (offer as NonNullable<typeof offer>).orgId);
      tx.ev("chosen", { helperId: cmd.helperId, fee: e.fee, by: ctx.actor.kind === "system" ? "auto" : "customer" });
      break;
    }

    case "withdraw_offer": {
      const e = asErrand(d, "withdraw an application from");
      requireStatus(e, "withdraw an application from", "open");
      let helperId: string;
      if (ctx.actor.kind === "system") {
        helperId = cmd.helperId ?? fail("INVALID_INPUT", "helperId is required");
      } else {
        helperId = requireUser(ctx).id;
      }
      if (!e.offers.some((o) => o.helperId === helperId)) fail("INVALID_INPUT", "No application to withdraw");
      e.offers = e.offers.filter((o) => o.helperId !== helperId);
      tx.ev("offer_withdrawn", { helperId });
      break;
    }

    case "cancel": {
      const u = requireUser(ctx);
      if (d.type === "errand") {
        if (u.id === d.customerId) {
          requireStatus(d, "cancel", "open", "awaiting_payment", "matched");
          if (d.status === "matched" && d.payMode === "direct") {
            // direct: cancelling after the helper was chosen and the fee paid — our fee is kept (owner, 2026-11-18)
            tx.fromHold("platform_fee", d.heldAmount, "platform");
            tx.ev("fee_kept", { amount: d.serviceFee });
          } else if (d.status === "matched") {
            const helperId = d.helperId as string;
            const fee = Math.min(d.cancelFee, d.heldAmount);
            tx.fromHold("cancel_fee", fee, payable(d.payeeOrgId ?? helperId));
            tx.ev("cancel_fee_paid", d.payeeOrgId ? { amount: fee, helperId, orgId: d.payeeOrgId } : { amount: fee, helperId });
          }
          refundAll(tx, "customer_cancelled");
          if (d.priceChange?.status !== "paid") d.priceChange = null;
          d.status = "cancelled";
          tx.ev("cancelled", { by: "customer" });
        } else if (d.helperId !== null && u.id === d.helperId) {
          // The chosen helper backs out (docs/decisions.md 2026-11-17 "Backing out"): the task is
          // posted anew — everything held goes back to the customer, the job's progress is cleared,
          // a full search window starts, and helpers are notified again. Free within the grace
          // after being chosen; later it counts against the helper (escalating pause, in the DB).
          requireStatus(d, "cancel", "awaiting_payment", "matched", "in_progress");
          const late = d.assignedAt === null || ctx.now - d.assignedAt > ruleOf(d, "backOutGraceMinutes") * MINUTE_MS;
          refundAll(tx, "helper_backed_out");
          if (d.topUp?.status === "paid") d.itemBudget -= d.topUp.amount; // the extra was refunded with the rest
          d.topUp = null;
          d.receiptAmount = null;
          d.handoverProofAt = null;
          d.priceChange = null;
          d.paymentRef = null;
          d.offers = d.offers.filter((o) => o.helperId !== u.id); // they can't be chosen again
          unassignHelper(d);
          d.matchBy = Math.max(d.scheduledAt ?? 0, ctx.now + ruleOf(d, "rematchWindowMinutes") * MINUTE_MS);
          // a direct request to this helper opens to everyone now
          if (d.invite?.helperId === u.id) d.invite = { ...d.invite, until: ctx.now, openAfter: true };
          if (late) {
            tx.effects.push({ kind: "helper_penalty", helperId: u.id, dealId: d.id });
            tx.ev("helper_backed_out", { helperId: u.id });
          } else {
            tx.ev("helper_withdrew", { helperId: u.id });
          }
        } else {
          fail("FORBIDDEN", "Only the customer or the assigned helper can cancel");
        }
      } else {
        if (u.id !== d.sellerId) fail("FORBIDDEN", "Only the seller can cancel a SafePay deal");
        requireStatus(d, "cancel", "awaiting_payment", "held");
        refundAll(tx, "seller_cancelled");
        d.status = "cancelled";
        tx.ev("cancelled", { by: "seller" });
      }
      break;
    }

    case "expire": {
      const e = asErrand(d, "expire");
      requireKind(ctx, "system", "Expiry");
      requireStatus(e, "expire", "awaiting_payment", "open");
      if (e.status === "awaiting_payment") {
        // Matched but not paid in time: release the helper. Nothing is held, nothing to refund.
        if (e.payBy === null || ctx.now < e.payBy) fail("ILLEGAL_TRANSITION", "Payment window has not ended yet");
        const helperId = e.helperId as string;
        if (e.mode === "schedule") e.offers = e.offers.filter((o) => o.helperId !== helperId);
        unassignHelper(e);
        if (e.matchBy !== null && ctx.now >= e.matchBy) {
          e.status = "expired";
          tx.ev("payment_expired");
        } else {
          tx.ev("payment_timeout", { helperId });
        }
        break;
      }
      if (e.matchBy === null || ctx.now < e.matchBy) fail("ILLEGAL_TRANSITION", "Match window has not ended yet");
      refundAll(tx, "no_helper"); // legacy deals paid at posting
      e.status = "expired";
      tx.ev("expired");
      break;
    }

    case "start": {
      const e = asErrand(d, "start");
      requireAssignedHelper(ctx, e);
      requireStatus(e, "start", "matched");
      e.status = "in_progress";
      tx.ev("started");
      break;
    }

    case "record_receipt": {
      const e = asErrand(d, "record a receipt for");
      requireAssignedHelper(ctx, e);
      requireStatus(e, "record a receipt for", "in_progress");
      if (e.itemBudget === 0) fail("INVALID_INPUT", "This task has no item budget");
      assertMoney(cmd.amount, "receipt amount");
      e.receiptAmount = cmd.amount;
      tx.ev("receipt_recorded", { amount: cmd.amount });
      if (e.payMode === "direct") {
        // direct: nothing held for items — the customer repays the receipt to the helper at handover
      } else if (cmd.amount > e.itemBudget) {
        // Over budget: ask the customer to approve and pay the difference (docs/rules.md §Buy-for-me).
        e.topUp = { amount: cmd.amount - e.itemBudget, status: "pending", providerRef: null, at: ctx.now };
        tx.ev("topup_requested", { amount: e.topUp.amount, receipt: cmd.amount });
      } else if (e.topUp !== null && e.topUp.status !== "paid") {
        // A new receipt within budget (items dropped / re-bought) replaces a pending or declined request.
        e.topUp = null;
      }
      break;
    }

    case "confirm_topup": {
      const e = asErrand(d, "confirm a top-up for");
      requireKind(ctx, "provider", "Top-up confirmation");
      // As with the first payment: if this throws, the caller must refund the payment via the provider.
      requireStatus(e, "confirm a top-up for", "in_progress");
      if (e.topUp === null || e.topUp.status !== "pending") fail("ILLEGAL_TRANSITION", "No top-up is waiting for payment");
      assertMoney(cmd.amount, "amount");
      if (!cmd.providerRef) fail("INVALID_INPUT", "providerRef is required");
      const topUp = e.topUp as NonNullable<ErrandDeal["topUp"]>;
      if (cmd.amount !== topUp.amount) fail("PAYMENT_MISMATCH", `Expected ₮${topUp.amount}, provider confirmed ₮${cmd.amount}`);
      tx.payIn(cmd.amount, e.customerId, cmd.providerRef);
      e.itemBudget += cmd.amount;
      e.topUp = { ...topUp, status: "paid", providerRef: cmd.providerRef };
      tx.ev("topup_paid", { amount: cmd.amount });
      break;
    }

    case "decline_topup": {
      const e = asErrand(d, "decline a top-up for");
      requirePayer(ctx, e);
      requireStatus(e, "decline a top-up for", "in_progress");
      if (e.topUp === null || e.topUp.status !== "pending") fail("ILLEGAL_TRANSITION", "No top-up is waiting for an answer");
      // The helper returns the items; nothing is reimbursed, the helper still earns the task fee.
      e.topUp = { ...(e.topUp as NonNullable<ErrandDeal["topUp"]>), status: "declined" };
      e.receiptAmount = null;
      tx.ev("topup_declined");
      break;
    }

    case "propose_price": {
      const e = asErrand(d, "propose a new price for");
      const u = requireUser(ctx);
      const by = u.id === e.customerId ? "customer" : u.id === e.helperId ? "helper" : fail("FORBIDDEN", "Only the customer or the assigned helper can propose a price");
      requireStatus(e, "propose a new price for", "matched", "in_progress");
      if (e.priceChange?.status === "awaiting_payment") fail("ILLEGAL_TRANSITION", "The agreed new price is waiting for payment");
      checkPrice(e, cmd.price, ctx.now);
      if (cmd.price === e.fee) fail("INVALID_INPUT", "That is already the price");
      // a new proposal from either side replaces the last one (it's an answer, too)
      e.priceChange = { fee: cmd.price, from: e.fee, by, status: "proposed", providerRef: null, at: ctx.now };
      tx.ev("price_proposed", { price: cmd.price, by });
      break;
    }

    case "answer_price": {
      const e = asErrand(d, "answer a price on");
      const u = requireUser(ctx);
      requireStatus(e, "answer a price on", "matched", "in_progress");
      const pc = e.priceChange;
      if (!pc || pc.status !== "proposed") fail("ILLEGAL_TRANSITION", "No price proposal to answer");
      const proposal = pc as PriceChange;
      const other = proposal.by === "customer" ? e.helperId : e.customerId;
      if (u.id !== other) fail("FORBIDDEN", "Only the other side can answer this price");
      if (!cmd.accept) {
        e.priceChange = null;
        tx.ev("price_declined", { price: proposal.fee });
        break;
      }
      const diff = proposal.fee - e.fee;
      if (e.payMode === "direct") {
        // direct: the helper's price isn't held, so an agreed change simply counts
        e.fee = proposal.fee;
        e.priceChange = null;
        tx.ev("price_agreed", { from: proposal.from, to: proposal.fee, refund: 0 });
      } else if (diff < 0) {
        // lower: the difference goes back to the customer straight from the hold
        tx.fromHold("refund", -diff, ext(e.customerId));
        e.fee = proposal.fee;
        e.priceChange = null;
        tx.ev("price_agreed", { from: proposal.from, to: proposal.fee, refund: -diff });
      } else {
        // higher: it counts once the customer has paid the difference (held like the rest)
        e.priceChange = { ...proposal, status: "awaiting_payment" };
        tx.ev("price_agreed_pay", { from: proposal.from, to: proposal.fee, amount: diff });
      }
      break;
    }

    case "withdraw_price": {
      const e = asErrand(d, "withdraw a price on");
      const u = requireUser(ctx);
      if (u.id !== e.customerId && u.id !== e.helperId) fail("FORBIDDEN", "Only the customer or the assigned helper can do this");
      const pc = e.priceChange;
      if (!pc || pc.status === "paid") fail("ILLEGAL_TRANSITION", "Nothing to withdraw");
      // a proposal: only its author takes it back; an accepted increase not paid yet: either side may drop it
      if ((pc as PriceChange).status === "proposed" && (pc as PriceChange).by !== (u.id === e.customerId ? "customer" : "helper")) {
        fail("FORBIDDEN", "Answer the other side's proposal instead");
      }
      e.priceChange = null;
      tx.ev("price_withdrawn");
      break;
    }

    case "confirm_price": {
      const e = asErrand(d, "confirm a price change for");
      requireKind(ctx, "provider", "Price change confirmation");
      // as with the first payment: if this throws, the caller must refund the payment via the provider
      requireStatus(e, "confirm a price change for", "matched", "in_progress");
      const pc = e.priceChange;
      if (!pc || pc.status !== "awaiting_payment") fail("ILLEGAL_TRANSITION", "No agreed price is waiting for payment");
      const change = pc as PriceChange;
      assertMoney(cmd.amount, "amount");
      if (!cmd.providerRef) fail("INVALID_INPUT", "providerRef is required");
      const due = change.fee - e.fee;
      if (cmd.amount !== due) fail("PAYMENT_MISMATCH", `Expected ₮${due}, provider confirmed ₮${cmd.amount}`);
      tx.payIn(cmd.amount, e.customerId, cmd.providerRef);
      e.fee = change.fee;
      e.priceChange = { ...change, status: "paid", providerRef: cmd.providerRef };
      tx.ev("price_paid", { amount: cmd.amount, to: change.fee });
      break;
    }

    case "record_handover": {
      const e = asErrand(d, "record handover for");
      requireAssignedHelper(ctx, e);
      requireStatus(e, "record handover for", "in_progress");
      e.handoverProofAt = ctx.now;
      tx.ev("handover_recorded");
      break;
    }

    case "finish": {
      const e = asErrand(d, "finish");
      requireAssignedHelper(ctx, e);
      requireStatus(e, "finish", "in_progress");
      if (e.handoverProofAt === null) fail("PROOF_MISSING", "A handover photo is required before marking done");
      if (e.topUp?.status === "pending") fail("ILLEGAL_TRANSITION", "Waiting for the customer to approve the extra amount");
      if (e.priceChange?.status === "awaiting_payment") fail("ILLEGAL_TRANSITION", "Waiting for the customer to pay the agreed new price");
      if (e.priceChange?.status === "proposed") e.priceChange = null; // an unanswered proposal lapses at "done"
      const itemsReturned = e.topUp?.status === "declined";
      if (e.itemBudget > 0 && e.receiptAmount === null && !itemsReturned) {
        fail("PROOF_MISSING", "A receipt is required before marking done");
      }
      e.status = "check";
      e.checkUntil = ctx.now + e.checkHours * HOUR_MS;
      tx.ev("done", { checkHours: e.checkHours });
      break;
    }

    case "handover": {
      const g = asGoods(d, "hand over");
      const u = requireUser(ctx);
      if (u.id !== g.sellerId) fail("FORBIDDEN", "Only the seller can mark the item handed over");
      requireStatus(g, "hand over", "held");
      g.status = "check";
      g.handedOverAt = ctx.now;
      g.checkUntil = ctx.now + g.checkHours * HOUR_MS;
      tx.ev("handed_over", { checkHours: g.checkHours });
      break;
    }

    case "confirm": {
      requirePayer(ctx, d);
      requireStatus(d, "confirm", "check");
      release(tx, "confirmed");
      break;
    }

    case "dispute": {
      const u = requirePayer(ctx, d);
      requireStatus(d, "dispute", "check");
      if (!cmd.reason.trim()) fail("INVALID_INPUT", "A reason is required");
      d.status = "disputed";
      d.dispute = {
        openedBy: u.id,
        reason: cmd.reason.trim(),
        note: (cmd.note ?? "").trim(),
        at: ctx.now,
        outcome: null,
        decidedBy: null,
        decidedAt: null,
      };
      tx.ev("disputed", { reason: d.dispute.reason });
      break;
    }

    case "resolve": {
      const u = requireUser(ctx);
      if (u.role !== "admin") fail("FORBIDDEN", "Only Ops can resolve disputes");
      requireStatus(d, "resolve", "disputed");
      const dispute = d.dispute;
      if (dispute === null) fail("INVARIANT_BROKEN", `Disputed deal ${d.id} has no dispute record`);
      if (cmd.outcome === "release") {
        release(tx, "ops");
      } else if (cmd.outcome === "refund") {
        refundAll(tx, "ops_decision");
        d.status = "refunded";
      } else {
        fail("INVALID_INPUT", "Outcome must be release or refund");
      }
      Object.assign(dispute as object, { outcome: cmd.outcome, decidedBy: u.id, decidedAt: ctx.now });
      tx.ev("dispute_resolved", { outcome: cmd.outcome });
      break;
    }

    case "auto_release": {
      requireKind(ctx, "system", "Auto-release");
      requireStatus(d, "auto-release", "check");
      if (d.checkUntil === null || ctx.now < d.checkUntil) fail("ILLEGAL_TRANSITION", "Check window has not ended yet");
      release(tx, "auto");
      break;
    }

    default: {
      const never: never = cmd;
      throw new EngineError("INVALID_INPUT", `Unknown command ${JSON.stringify(never)}`);
    }
  }

  return tx.done();
}
