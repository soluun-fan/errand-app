import type { CategoryId } from "./config";

export type ErrandStatus =
  | "awaiting_payment"
  | "open"
  | "matched"
  | "in_progress"
  | "check"
  | "disputed"
  | "released"
  | "refunded"
  | "cancelled"
  | "expired";

export type GoodsStatus =
  | "awaiting_payment"
  | "held"
  | "check"
  | "disputed"
  | "released"
  | "refunded"
  | "cancelled";

export type DealStatus = ErrandStatus | GoodsStatus;

export const TERMINAL_STATUSES: readonly DealStatus[] = ["released", "refunded", "cancelled", "expired"];

export type Mode = "now" | "schedule";
export type Lift = "yes" | "no" | "unknown";

/** Task details that drive the system price and eligibility (docs/rules.md, DESIGN §8.2). */
export interface ErrandDetails {
  /** Distance pickup → drop-off: from the two pins when both are set, else the customer's estimate; 0 for single-location tasks. */
  km: number;
  entrance: string | null;
  floor: number | null;
  unit: string | null;
  lift: Lift | null;
  /** "Ж: Орцны код, хаалганы өнгө…" */
  note: string | null;
  people: 1 | 2;
  /** Carry: the helper carries it (true) or the customer brings it down (false). */
  carryByHelper: boolean;
  /** Carry: big / heavy item (decides the 2-person rule). */
  heavy: boolean;
  /** Helper comes back to the start (e.g. take keys and return). Needs a distance. */
  roundTrip: boolean;
  /** Buy-for-me: customer allowed going up to 10% over the budget; the extra is held too. */
  budgetBuffer: boolean;
  /** "Choose for me": if the customer hasn't picked, the system picks the best applicant. */
  autoPick: boolean;
  /** About how long the job takes (30-minute steps). Prices the time beyond the base. */
  minutes: number;
  /** The helper must bring tools. */
  tools: boolean;
  /** Set by the engine at posting: the recommended (system) price; 0 on older deals. */
  quotedFee: number;
  /** No longer used (bargaining has no cap since 2026-11-16); kept for older deals. */
  counterMax: number;
}

export const DEFAULT_DETAILS: ErrandDetails = {
  km: 0,
  entrance: null,
  floor: null,
  unit: null,
  lift: null,
  note: null,
  people: 1,
  carryByHelper: true,
  heavy: false,
  roundTrip: false,
  budgetBuffer: false,
  autoPick: false,
  minutes: 30,
  tools: false,
  quotedFee: 0,
  counterMax: 0,
};

/**
 * Receipt over the item budget (docs/rules.md §Buy-for-me): the customer approves and pays the
 * difference as a second held payment, or declines and the helper returns the items.
 */
export interface TopUp {
  amount: number;
  status: "pending" | "paid" | "declined";
  /** Provider reference of the top-up payment, once paid (makes the webhook idempotent). */
  providerRef: string | null;
  at: number;
}
export type DisputeOutcome = "release" | "refund";

export interface Offer {
  helperId: string;
  note: string;
  /**
   * The price on the table between this helper and the customer (null = the customer's posted
   * price). Bargaining is open both ways, any number of rounds (docs/decisions.md 2026-11-16).
   */
  price: number | null;
  /** Who named `price` last — the other side may accept it. "helper" when price is null. */
  proposedBy: "helper" | "customer";
  at: number;
}

/** WGS84 pin for the task (drop-off / where it happens). Drives distance-based dispatch. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Dispute {
  openedBy: string;
  reason: string;
  note: string;
  at: number;
  outcome: DisputeOutcome | null;
  decidedBy: string | null;
  decidedAt: number | null;
}

interface DealBase {
  id: string;
  /** Incremented on every successful transition; use for optimistic locking when persisting. */
  version: number;
  title: string;
  description: string;
  /** Money currently in the bank hold for this deal. */
  heldAmount: number;
  /** Provider reference of the pay-in; used to make the webhook idempotent. */
  paymentRef: string | null;
  /** Check window length, snapshotted at creation. */
  checkHours: number;
  checkUntil: number | null;
  dispute: Dispute | null;
  createdAt: number;
}

export interface ErrandDeal extends DealBase {
  type: "errand";
  status: ErrandStatus;
  category: CategoryId;
  mode: Mode;
  scheduledAt: number | null;
  /** Optional: where the helper picks something up (store, office). */
  pickupAddress: string | null;
  /** Map pin for the pickup; with `location` it sets `details.km` (fixed at posting). */
  pickupLocation: GeoPoint | null;
  address: string;
  /** Map pin for `address`; null when the customer typed an address only. */
  location: GeoPoint | null;
  /** After a helper is matched, the customer must pay by this time (null otherwise). */
  payBy: number | null;
  details: ErrandDetails;
  itemBudget: number;
  /** The helper fee to be held: the posted fee, or the chosen helper's quote. */
  fee: number;
  /** The fee the customer posted; restored when a match lapses unpaid. */
  postedFee: number;
  /** Fee terms snapshotted at posting so config changes don't alter existing deals. */
  serviceFee: number;
  commissionBps: number;
  cancelFee: number;
  maxApplicants: number;
  matchWindowMinutes: number;
  customerId: string;
  helperId: string | null;
  offers: Offer[];
  /** Deadline for finding a helper; set at posting. */
  matchBy: number | null;
  receiptAmount: number | null;
  /** Pending / paid / declined over-budget top-up, if the receipt ever exceeded the budget. */
  topUp: TopUp | null;
  /** A price change after matching (proposed by either side, accepted by the other). */
  priceChange: PriceChange | null;
  handoverProofAt: number | null;
}

export interface GoodsDeal extends DealBase {
  type: "goods";
  status: GoodsStatus;
  price: number;
  buyerFee: number;
  sellerId: string;
  buyerId: string | null;
  /** 6-character code the seller shares; deals open only inside the app by code. */
  code: string;
  handedOverAt: number | null;
}

export type Deal = ErrandDeal | GoodsDeal;

/* ---------- actors ---------- */

export type Role = "customer" | "helper" | "admin";

export interface UserActor {
  kind: "user";
  id: string;
  role: Role;
  /** Only relevant for helpers. */
  helperApproved?: boolean;
  categories?: readonly CategoryId[];
}

/** The payment provider's verified webhook. */
export interface ProviderActor {
  kind: "provider";
}

/** Background jobs (auto-release, expiry). */
export interface SystemActor {
  kind: "system";
}

export type Actor = UserActor | ProviderActor | SystemActor;

export interface Ctx {
  now: number;
  actor: Actor;
}

/**
 * Changing the price after a helper is chosen and paid (docs/decisions.md 2026-11-16): one side
 * proposes `fee`, the other accepts or declines. Lower → the difference is refunded at once;
 * higher → the customer pays the difference (held like the rest) before it counts.
 */
export interface PriceChange {
  fee: number;
  /** The helper's fee when it was proposed. */
  from: number;
  by: "customer" | "helper";
  status: "proposed" | "awaiting_payment" | "paid";
  /** Set when the extra was paid (makes the webhook idempotent). */
  providerRef: string | null;
  at: number;
}

/* ---------- commands ---------- */

export type Command =
  | { type: "confirm_payment"; providerRef: string; amount: number }
  | { type: "claim" } // goods: buyer attaches to the deal before paying
  | { type: "accept" } // errand now-mode: first helper wins
  | { type: "apply"; note: string; price?: number } // helper: take the posted price, or name their own
  | { type: "reprice"; price: number } // helper: name a new price on their own offer
  | { type: "counter"; helperId: string; price: number } // customer: answer one helper with a price
  | { type: "accept_counter" } // helper: accept the customer's price → matched, customer pays
  | { type: "set_price"; price: number } // customer: change the posted price while still open
  | { type: "propose_price"; price: number } // after matching: customer or helper proposes a new fee
  | { type: "answer_price"; accept: boolean } // the other side accepts or declines it
  | { type: "withdraw_price" } // drop a proposal (or an accepted increase not paid yet)
  | { type: "confirm_price"; providerRef: string; amount: number } // provider webhook: the extra was paid
  | { type: "choose"; helperId: string } // customer — or the system for "Choose for me"
  | { type: "withdraw_offer"; helperId?: string } // helper takes back an application (or the system, once they're busy elsewhere)
  | { type: "cancel" }
  | { type: "expire" }
  | { type: "start" }
  | { type: "record_receipt"; amount: number }
  | { type: "confirm_topup"; providerRef: string; amount: number } // provider webhook for the top-up
  | { type: "decline_topup" } // customer: don't pay more, helper returns the items
  | { type: "record_handover" }
  | { type: "finish" }
  | { type: "handover" } // goods: seller handed the item over
  | { type: "confirm" }
  | { type: "dispute"; reason: string; note?: string }
  | { type: "resolve"; outcome: DisputeOutcome }
  | { type: "auto_release" };

export type CommandType = Command["type"];

/* ---------- outputs ---------- */

/**
 * Ledger accounts.
 * - `ext:<userId>`     the user's own bank account outside our system (pay-in source, refund target)
 * - `hold`             the partner bank's hold account (entries carry dealId)
 * - `payable:<userId>` money released to a helper/seller, awaiting withdrawal
 * - `platform`         platform revenue
 */
export type Account = `ext:${string}` | "hold" | `payable:${string}` | "platform";

export type LedgerKind =
  | "pay_in"
  | "release_fee"
  | "item_reimburse"
  | "budget_refund"
  | "platform_fee"
  | "release_seller"
  | "cancel_fee"
  | "refund"
  | "withdrawal";

export interface LedgerEntry {
  dealId: string | null;
  kind: LedgerKind;
  /** Always a positive integer; direction is from → to. */
  amount: number;
  from: Account;
  to: Account;
  providerRef: string | null;
  at: number;
}

/** Timeline events carry a code + params so the UI can render them in Mongolian or English. */
export interface TimelineEvent {
  dealId: string;
  code: string;
  data: Record<string, string | number>;
  at: number;
}

export type Effect = { kind: "helper_penalty"; helperId: string; dealId: string };

export interface Transition<D extends Deal = Deal> {
  deal: D;
  events: TimelineEvent[];
  ledger: LedgerEntry[];
  effects: Effect[];
  /** True when the command was a duplicate (e.g. a replayed webhook) and nothing changed. */
  duplicate: boolean;
}
