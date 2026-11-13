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
import { DEFAULT_CONFIG, HOUR_MS, MINUTE_MS, type CategoryId, type EngineConfig } from "./config";
import { EngineError, assertMoney, fail } from "./errors";
import { ext, payable } from "./ledger";
import { amountDue, buyerFeeFor, errandSplit, heldItemBudget, minFeeAt, quoteFee } from "./money";
import { DEFAULT_DETAILS, type ErrandDetails } from "./types";
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
  if (!u.categories?.includes(d.category)) fail("FORBIDDEN", `Helper does not work in category "${d.category}"`);
  if (u.id === d.customerId) fail("FORBIDDEN", "You cannot take your own task");
  return u;
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
  if (d.type === "errand") {
    if (d.helperId === null) fail("INVARIANT_BROKEN", `Errand ${d.id} has no helper to release to`);
    const s = errandSplit({
      fee: d.fee,
      itemBudget: d.itemBudget,
      receipt: d.receiptAmount,
      serviceFee: d.serviceFee,
      commissionBps: d.commissionBps,
    });
    if (s.held !== d.heldAmount) fail("INVARIANT_BROKEN", `Errand ${d.id}: split total ${s.held} != held ${d.heldAmount}`);
    const helper = payable(d.helperId as string);
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
  address: string;
  itemBudget: number;
  fee: number;
  customerId: string;
  details?: Partial<ErrandDetails>;
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
  const details = normalizeDetails(input.details);
  const quote = quoteFee(input.category, details, cfg, scheduledAt ?? ctx.now);
  if (details.people < quote.peopleRequired) fail("INVALID_INPUT", "This task needs 2 people");
  const minFee = Math.max(minFeeAt(scheduledAt ?? ctx.now, cfg), quote.total);
  if (input.fee < minFee) fail("INVALID_INPUT", `Minimum fee is ₮${minFee}`);
  if (input.itemBudget === 0) details.budgetBuffer = false;
  // `itemBudget` is what the customer typed; the deal holds it plus the optional buffer.
  const itemBudget = heldItemBudget(input.itemBudget, details.budgetBuffer, cfg);

  const deal: ErrandDeal = {
    id: input.id,
    version: 0,
    type: "errand",
    status: "awaiting_payment",
    title,
    description,
    category: input.category,
    mode: input.mode,
    scheduledAt,
    pickupAddress: input.pickupAddress?.trim() || null,
    address: input.address.trim(),
    payBy: ctx.now + cfg.paymentWindowMinutes * MINUTE_MS,
    details,
    itemBudget,
    fee: input.fee,
    serviceFee: cfg.serviceFee,
    commissionBps: cfg.commissionBps,
    cancelFee: cfg.cancelFee,
    maxApplicants: cfg.maxApplicants,
    matchWindowMinutes: input.mode === "now" ? cfg.nowMatchWindowMinutes : cfg.scheduleMatchWindowMinutes,
    customerId: input.customerId,
    helperId: null,
    offers: [],
    matchBy: null,
    receiptAmount: null,
    topUp: null,
    handoverProofAt: null,
    heldAmount: 0,
    paymentRef: null,
    checkHours: cfg.errandCheckHours,
    checkUntil: null,
    dispute: null,
    createdAt: ctx.now,
  };
  return {
    deal,
    events: [{ dealId: deal.id, code: "posted", data: { amountDue: amountDue(deal) }, at: ctx.now }],
    ledger: [],
    effects: [],
    duplicate: false,
  };
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
      tx.ev("paid", { amount: cmd.amount });
      if (d.type === "errand") {
        d.status = "open";
        d.matchBy = d.scheduledAt !== null ? d.scheduledAt : ctx.now + d.matchWindowMinutes * MINUTE_MS;
        tx.ev("helpers_notified", { mode: d.mode });
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
      e.helperId = u.id;
      e.status = "matched";
      tx.ev("accepted", { helperId: u.id });
      break;
    }

    case "apply": {
      const e = asErrand(d, "apply");
      const u = requireEligibleHelper(ctx, e);
      requireStatus(e, "apply to", "open");
      if (e.mode !== "schedule") fail("ILLEGAL_TRANSITION", "Now tasks are first-to-accept; use accept");
      if (e.offers.some((o) => o.helperId === u.id)) fail("INVALID_INPUT", "You already applied");
      if (e.offers.length >= e.maxApplicants) fail("ILLEGAL_TRANSITION", `Task already has ${e.maxApplicants} applicants`);
      e.offers.push({ helperId: u.id, note: cmd.note.trim(), at: ctx.now });
      tx.ev("applied", { helperId: u.id });
      break;
    }

    case "choose": {
      const e = asErrand(d, "choose");
      requirePayer(ctx, e);
      requireStatus(e, "choose a helper for", "open");
      if (e.mode !== "schedule") fail("ILLEGAL_TRANSITION", "Only scheduled tasks have applicants to choose from");
      if (!e.offers.some((o) => o.helperId === cmd.helperId)) fail("INVALID_INPUT", "That helper did not apply");
      e.helperId = cmd.helperId;
      e.status = "matched";
      tx.ev("chosen", { helperId: cmd.helperId });
      break;
    }

    case "cancel": {
      const u = requireUser(ctx);
      if (d.type === "errand") {
        if (u.id === d.customerId) {
          requireStatus(d, "cancel", "awaiting_payment", "open", "matched");
          if (d.status === "matched") {
            const helperId = d.helperId as string;
            const fee = Math.min(d.cancelFee, d.heldAmount);
            tx.fromHold("cancel_fee", fee, payable(helperId));
            tx.ev("cancel_fee_paid", { amount: fee, helperId });
          }
          refundAll(tx, "customer_cancelled");
          d.status = "cancelled";
          tx.ev("cancelled", { by: "customer" });
        } else if (d.helperId !== null && u.id === d.helperId) {
          requireStatus(d, "cancel", "matched", "in_progress");
          refundAll(tx, "helper_cancelled");
          d.status = "cancelled";
          tx.effects.push({ kind: "helper_penalty", helperId: u.id, dealId: d.id });
          tx.ev("cancelled", { by: "helper" });
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
        // Never paid: nothing is held, nothing to refund.
        if (e.payBy === null || ctx.now < e.payBy) fail("ILLEGAL_TRANSITION", "Payment window has not ended yet");
        e.status = "expired";
        tx.ev("payment_expired");
        break;
      }
      if (e.matchBy === null || ctx.now < e.matchBy) fail("ILLEGAL_TRANSITION", "Match window has not ended yet");
      refundAll(tx, "no_helper");
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
      if (cmd.amount > e.itemBudget) {
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
