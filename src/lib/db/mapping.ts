/**
 * Converts between database rows (snake_case, ISO timestamps, as returned by PostgREST)
 * and engine objects (camelCase, epoch milliseconds). Pure — no I/O.
 */
import type { CategoryId } from "@/lib/engine/config";
import { DEFAULT_DETAILS } from "@/lib/engine/types";
import type {
  Deal,
  ErrandDetails,
  DealStatus,
  Dispute,
  DisputeOutcome,
  ErrandDeal,
  GoodsDeal,
  LedgerKind,
  Mode,
  Offer,
  PriceChange,
  TopUp,
  Transition,
  UserActor,
} from "@/lib/engine/types";
import { unverifiedHelpersTestMode } from "@/lib/helper-test-mode";

/** How long a helper is suspended after cancelling an accepted task (CLAUDE.md §3). */

/* ---------- row types ---------- */

export interface DealRow {
  id: string;
  version: number;
  type: "errand" | "goods";
  status: DealStatus;
  title: string;
  description: string;
  category: CategoryId | null;
  mode: Mode | null;
  scheduled_at: string | null;
  pickup_address: string | null;
  address: string | null;
  pay_by: string | null;
  details: Partial<ErrandDetails> | null;
  lat: number | null;
  lng: number | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  item_budget: number | null;
  fee: number | null;
  posted_fee: number | null;
  service_fee: number | null;
  commission_bps: number | null;
  cancel_fee: number | null;
  max_applicants: number | null;
  match_window_minutes: number | null;
  customer_id: string | null;
  helper_id: string | null;
  match_by: string | null;
  receipt_amount: number | null;
  top_up: TopUpRow | null;
  price_change?: PriceChangeRow | null;
  invited_helper_id?: string | null;
  payee_org_id?: string | null;
  invite_until?: string | null;
  invite_open_after?: boolean | null;
  handover_proof_at: string | null;
  assigned_at?: string | null;
  en_route_at?: string | null;
  arrive_extend_minutes?: number | null;
  absent_at?: string | null;
  pay_mode?: string | null;
  price: number | null;
  buyer_fee: number | null;
  seller_id: string | null;
  buyer_id: string | null;
  code: string | null;
  handed_over_at: string | null;
  held_amount: number;
  payment_ref: string | null;
  provider_refs?: string[] | null;
  check_hours: number;
  check_until: string | null;
  created_at: string;
}

/** `deals.top_up` jsonb (over-budget receipt, docs/rules.md §Buy-for-me). */
export interface TopUpRow {
  amount: number;
  status: TopUp["status"];
  provider_ref: string | null;
  at: string;
}

const topUpFromRow = (r: TopUpRow | null | undefined): TopUp | null =>
  r ? { amount: money(r.amount, "top_up.amount"), status: r.status, providerRef: r.provider_ref, at: req(toMs(r.at), "top_up.at") } : null;
const topUpToRow = (t: TopUp | null): TopUpRow | null =>
  t ? { amount: t.amount, status: t.status, provider_ref: t.providerRef, at: toIso(t.at) as string } : null;

export interface PriceChangeRow {
  fee: number;
  from: number;
  by: "customer" | "helper";
  status: "proposed" | "awaiting_payment" | "paid";
  provider_ref: string | null;
  at: string;
}

const priceChangeFromRow = (r: PriceChangeRow | null | undefined): PriceChange | null =>
  r ? { fee: Number(r.fee), from: Number(r.from), by: r.by, status: r.status, providerRef: r.provider_ref ?? null, at: req(toMs(r.at), "price_change.at") } : null;
const priceChangeToRow = (p: PriceChange | null): PriceChangeRow | null =>
  p ? { fee: p.fee, from: p.from, by: p.by, status: p.status, provider_ref: p.providerRef, at: toIso(p.at) as string } : null;

export interface OfferRow {
  helper_id: string;
  org_id?: string | null;
  note: string;
  price?: number | null;
  proposed_by?: "helper" | "customer" | null;
  created_at: string;
}

export interface DisputeRow {
  opened_by: string;
  reason: string;
  note: string;
  outcome: DisputeOutcome | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  phone: string | null;
  role: "customer" | "helper" | "admin";
  kyc_level: number;
  helper_status: "pending" | "approved" | "rejected" | null;
  verified_name: string | null;
  categories: CategoryId[];
  area: string | null;
  suspended_until: string | null;
  age_confirmed_at?: string | null;
  test_helper?: boolean;
  terms_version?: string | null;
  privacy_version?: string | null;
  helper_terms_version?: string | null;
  deleted_at?: string | null;
}

/* ---------- time + number helpers ---------- */

export const toIso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function toMs(v: string | null): number | null {
  if (v === null) return null;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) throw new Error(`Bad timestamp from database: ${v}`);
  return ms;
}

const req = <T>(v: T | null, field: string): T => {
  if (v === null || v === undefined) throw new Error(`Deal row is missing ${field}`);
  return v;
};

/** bigint columns arrive as JSON numbers; refuse anything that lost precision. */
function money(v: number | string | null, field: string): number {
  const n = typeof v === "string" ? Number(v) : req(v, field);
  if (!Number.isSafeInteger(n)) throw new Error(`${field} is not a safe integer: ${v}`);
  return n;
}
const moneyOrNull = (v: number | string | null, field: string) => (v === null ? null : money(v, field));

/* ---------- deal ---------- */

export function dealFromRow(row: DealRow, offers: OfferRow[] = [], dispute: DisputeRow | null = null): Deal {
  const base = {
    id: row.id,
    version: row.version,
    title: row.title,
    description: row.description,
    heldAmount: money(row.held_amount, "held_amount"),
    paymentRef: row.payment_ref,
    // older rows (before the column) → rebuilt from the refs the row still has
    providerRefs:
      row.provider_refs ??
      [row.payment_ref, row.top_up?.provider_ref ?? null, row.price_change?.provider_ref ?? null].filter((x): x is string => typeof x === "string"),
    checkHours: row.check_hours,
    checkUntil: toMs(row.check_until),
    dispute: dispute ? disputeFromRow(dispute) : null,
    createdAt: req(toMs(row.created_at), "created_at"),
  };
  if (row.type === "errand") {
    const d: ErrandDeal = {
      ...base,
      type: "errand",
      status: row.status as ErrandDeal["status"],
      category: req(row.category, "category"),
      mode: req(row.mode, "mode"),
      scheduledAt: toMs(row.scheduled_at),
      pickupAddress: row.pickup_address ?? null,
      pickupLocation:
        row.pickup_lat !== null && row.pickup_lat !== undefined && row.pickup_lng !== null && row.pickup_lng !== undefined
          ? { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) }
          : null,
      address: req(row.address, "address"),
      location: row.lat !== null && row.lng !== null ? { lat: Number(row.lat), lng: Number(row.lng) } : null,
      payBy: toMs(row.pay_by ?? null),
      details: { ...DEFAULT_DETAILS, ...(row.details ?? {}) },
      itemBudget: money(row.item_budget, "item_budget"),
      fee: money(row.fee, "fee"),
      postedFee: money(row.posted_fee ?? row.fee, "posted_fee"),
      serviceFee: money(row.service_fee, "service_fee"),
      commissionBps: req(row.commission_bps, "commission_bps"),
      cancelFee: money(row.cancel_fee, "cancel_fee"),
      maxApplicants: req(row.max_applicants, "max_applicants"),
      matchWindowMinutes: req(row.match_window_minutes, "match_window_minutes"),
      customerId: req(row.customer_id, "customer_id"),
      helperId: row.helper_id,
      offers: [...offers]
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .map((o) => ({
          helperId: o.helper_id,
          orgId: o.org_id ?? null,
          note: o.note,
          price: moneyOrNull(o.price ?? null, "offer.price"),
          proposedBy: o.proposed_by === "customer" ? ("customer" as const) : ("helper" as const),
          at: req(toMs(o.created_at), "offer.created_at"),
        })),
      matchBy: toMs(row.match_by),
      receiptAmount: moneyOrNull(row.receipt_amount, "receipt_amount"),
      topUp: topUpFromRow(row.top_up),
      priceChange: priceChangeFromRow(row.price_change),
      payeeOrgId: row.payee_org_id ?? null,
      invite:
        row.invited_helper_id && row.invite_until
          ? { helperId: row.invited_helper_id, until: req(toMs(row.invite_until), "invite_until"), openAfter: row.invite_open_after !== false }
          : null,
      handoverProofAt: toMs(row.handover_proof_at),
      assignedAt: toMs(row.assigned_at ?? null),
      enRouteAt: toMs(row.en_route_at ?? null),
      arriveExtendMinutes: Number(row.arrive_extend_minutes ?? 0),
      absentAt: toMs(row.absent_at ?? null),
      payMode: row.pay_mode === "direct" ? "direct" : "held",
    };
    return d;
  }
  const g: GoodsDeal = {
    ...base,
    type: "goods",
    status: row.status as GoodsDeal["status"],
    price: money(row.price, "price"),
    buyerFee: money(row.buyer_fee, "buyer_fee"),
    sellerId: req(row.seller_id, "seller_id"),
    buyerId: row.buyer_id,
    code: req(row.code, "code"),
    handedOverAt: toMs(row.handed_over_at),
  };
  return g;
}

export function dealToRow(d: Deal): DealRow {
  const empty = {
    category: null,
    mode: null,
    scheduled_at: null,
    pickup_address: null,
    address: null,
    pay_by: null,
    details: {}, // column is NOT NULL; goods deals have no task details
    lat: null,
    lng: null,
    pickup_lat: null,
    pickup_lng: null,
    item_budget: null,
    fee: null,
    posted_fee: null,
    service_fee: null,
    commission_bps: null,
    cancel_fee: null,
    max_applicants: null,
    match_window_minutes: null,
    customer_id: null,
    helper_id: null,
    match_by: null,
    receipt_amount: null,
    top_up: null,
    price_change: null,
    invited_helper_id: null,
    payee_org_id: null,
    invite_until: null,
    invite_open_after: true,
    handover_proof_at: null,
    assigned_at: null,
    pay_mode: "held", // SafePay deals hold the money (only errands can be fee-only)
    price: null,
    buyer_fee: null,
    seller_id: null,
    buyer_id: null,
    code: null,
    handed_over_at: null,
  };
  const common = {
    id: d.id,
    version: d.version,
    type: d.type,
    status: d.status,
    title: d.title,
    description: d.description,
    held_amount: d.heldAmount,
    payment_ref: d.paymentRef,
    provider_refs: d.providerRefs,
    check_hours: d.checkHours,
    check_until: toIso(d.checkUntil),
    created_at: toIso(d.createdAt) as string,
  };
  if (d.type === "errand") {
    return {
      ...empty,
      ...common,
      category: d.category,
      mode: d.mode,
      scheduled_at: toIso(d.scheduledAt),
      pickup_address: d.pickupAddress,
      address: d.address,
      pay_by: toIso(d.payBy),
      details: d.details,
      lat: d.location?.lat ?? null,
      lng: d.location?.lng ?? null,
      pickup_lat: d.pickupLocation?.lat ?? null,
      pickup_lng: d.pickupLocation?.lng ?? null,
      item_budget: d.itemBudget,
      fee: d.fee,
      posted_fee: d.postedFee,
      service_fee: d.serviceFee,
      commission_bps: d.commissionBps,
      cancel_fee: d.cancelFee,
      max_applicants: d.maxApplicants,
      match_window_minutes: d.matchWindowMinutes,
      customer_id: d.customerId,
      helper_id: d.helperId,
      match_by: toIso(d.matchBy),
      receipt_amount: d.receiptAmount,
      top_up: topUpToRow(d.topUp),
      price_change: priceChangeToRow(d.priceChange),
      invited_helper_id: d.invite?.helperId ?? null,
      payee_org_id: d.payeeOrgId,
      invite_until: toIso(d.invite?.until ?? null),
      invite_open_after: d.invite?.openAfter ?? true,
      handover_proof_at: toIso(d.handoverProofAt),
      assigned_at: toIso(d.assignedAt),
      en_route_at: toIso(d.enRouteAt ?? null),
      arrive_extend_minutes: d.arriveExtendMinutes ?? 0,
      absent_at: toIso(d.absentAt ?? null),
      pay_mode: d.payMode,
    };
  }
  return {
    ...empty,
    ...common,
    price: d.price,
    buyer_fee: d.buyerFee,
    seller_id: d.sellerId,
    buyer_id: d.buyerId,
    code: d.code,
    handed_over_at: toIso(d.handedOverAt),
  };
}

function disputeFromRow(r: DisputeRow): Dispute {
  return {
    openedBy: r.opened_by,
    reason: r.reason,
    note: r.note,
    at: req(toMs(r.created_at), "dispute.created_at"),
    outcome: r.outcome,
    decidedBy: r.decided_by,
    decidedAt: toMs(r.decided_at),
  };
}

function disputeToRow(d: Dispute): DisputeRow {
  return {
    opened_by: d.openedBy,
    reason: d.reason,
    note: d.note,
    outcome: d.outcome,
    decided_by: d.decidedBy,
    decided_at: toIso(d.decidedAt),
    created_at: toIso(d.at) as string,
  };
}

/* ---------- RPC payloads ---------- */

const eventRows = (t: Transition) =>
  t.events.map((e) => ({ code: e.code, data: e.data, created_at: toIso(e.at) }));

/** Arguments for `insert_deal()`; `t` must come from createErrand/createGoods. */
export function insertDealArgs(t: Transition) {
  if (t.deal.version !== 0 || t.ledger.length > 0) throw new Error("insertDealArgs expects a freshly created deal");
  return { p_deal: dealToRow(t.deal), p_events: eventRows(t) };
}

export interface LedgerRow {
  kind: LedgerKind;
  amount: number;
  from_account: string;
  to_account: string;
  provider_ref: string | null;
  created_at: string | null;
}

/** Arguments for `apply_transition()`: the diff between `before` and the engine's result. */
export function applyTransitionArgs(before: Deal, t: Transition, now: number) {
  const after = t.deal;
  const beforeOffers = new Map(before.type === "errand" ? before.offers.map((o) => [o.helperId, o]) : []);
  const kept = new Set(after.type === "errand" ? after.offers.map((o) => o.helperId) : []);
  // A re-priced offer (bargaining) is written as delete + insert of the same row.
  const changed = (o: Offer) => {
    const b = beforeOffers.get(o.helperId);
    return b !== undefined && (b.orgId !== o.orgId || b.price !== o.price || b.proposedBy !== o.proposedBy || b.at !== o.at || b.note !== o.note);
  };
  const newOffers =
    after.type === "errand"
      ? after.offers
          .filter((o) => !beforeOffers.has(o.helperId) || changed(o))
          .map((o) => ({ helper_id: o.helperId, org_id: o.orgId, note: o.note, price: o.price, proposed_by: o.proposedBy, created_at: toIso(o.at) }))
      : [];
  // Offers dropped by the transition (helper withdrew / match lapsed unpaid), or re-priced.
  const removedOffers = [
    ...[...beforeOffers.keys()].filter((h) => !kept.has(h)),
    ...(after.type === "errand" ? after.offers.filter(changed).map((o) => o.helperId) : []),
  ];
  const disputeChanged = JSON.stringify(before.dispute) !== JSON.stringify(after.dispute);
  const ledger: LedgerRow[] = t.ledger.map((l) => ({
    kind: l.kind,
    amount: l.amount,
    from_account: l.from,
    to_account: l.to,
    provider_ref: l.providerRef,
    created_at: toIso(l.at),
  }));
  const suspend = t.effects
    .filter((e) => e.kind === "helper_penalty")
    // the database decides the pause length from the helper's recent back-outs (escalating)
    .map((e) => ({ user_id: e.helperId, at: toIso(now) }));

  return {
    p_deal_id: before.id,
    p_expected_version: before.version,
    p_deal: dealToRow(after),
    p_new_offers: newOffers,
    p_removed_offers: removedOffers,
    p_dispute: disputeChanged && after.dispute ? disputeToRow(after.dispute) : null,
    p_events: eventRows(t),
    p_ledger: ledger,
    p_suspend: suspend,
  };
}

/* ---------- actor ---------- */

/** Builds the engine actor for a signed-in user. Suspended helpers can't take tasks. */
export function actorFromProfile(p: ProfileRow, now: number): UserActor {
  const suspended = p.suspended_until !== null && Date.parse(p.suspended_until) > now;
  return {
    kind: "user",
    id: p.id,
    role: p.role,
    helperApproved: p.role === "helper" && p.helper_status === "approved" && !suspended && (!p.test_helper || unverifiedHelpersTestMode),
    categories: p.categories,
  };
}
