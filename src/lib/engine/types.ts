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
export type DisputeOutcome = "release" | "refund";

export interface Offer {
  helperId: string;
  note: string;
  at: number;
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
  address: string;
  itemBudget: number;
  fee: number;
  /** Fee terms snapshotted at posting so config changes don't alter existing deals. */
  serviceFee: number;
  commissionBps: number;
  cancelFee: number;
  maxApplicants: number;
  matchWindowMinutes: number;
  customerId: string;
  helperId: string | null;
  offers: Offer[];
  /** Deadline for finding a helper; set when payment is confirmed. */
  matchBy: number | null;
  receiptAmount: number | null;
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

/* ---------- commands ---------- */

export type Command =
  | { type: "confirm_payment"; providerRef: string; amount: number }
  | { type: "claim" } // goods: buyer attaches to the deal before paying
  | { type: "accept" } // errand now-mode: first helper wins
  | { type: "apply"; note: string } // errand schedule-mode
  | { type: "choose"; helperId: string }
  | { type: "cancel" }
  | { type: "expire" }
  | { type: "start" }
  | { type: "record_receipt"; amount: number }
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
