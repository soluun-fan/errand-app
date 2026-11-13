/**
 * Mapping from engine values to UI keys, tones and icons. All wording lives in src/i18n.
 */
import type { MessageKey, T } from "@/i18n";
import type { CategoryId } from "@/lib/engine/config";
import type { DealStatus } from "@/lib/engine/types";
import { fmtMoney } from "./format";

/**
 * Status colours mean status only (docs/ui.md): held = money held safely (green),
 * warn = needs attention / time running (amber), bad = dispute or error (red),
 * info = neutral information, grey = closed.
 */
export type Tone = "held" | "warn" | "bad" | "info" | "grey";

export const TONE_CLASS: Record<Tone, string> = {
  held: "bg-held-bg text-held border-held/20",
  warn: "bg-warn-bg text-warn border-warn/20",
  bad: "bg-danger-bg text-danger border-danger/20",
  info: "bg-fill text-ink border-line",
  grey: "bg-fill text-ink-2 border-line",
};

export const STATUS_TONE: Record<DealStatus, Tone> = {
  awaiting_payment: "warn",
  open: "held",
  matched: "held",
  in_progress: "held",
  held: "held",
  check: "warn",
  disputed: "bad",
  released: "held",
  refunded: "grey",
  cancelled: "grey",
  expired: "grey",
};

export const CATEGORY_ICON: Record<CategoryId, string> = {
  shop: "🛒",
  carry: "📦",
  queue: "⏳",
  deliver: "🚚",
  repair: "🔧",
  other: "✨",
};

export const DISPUTE_REASONS = ["notDone", "doneBadly", "wrongItem", "damaged", "overcharged", "other"] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export const RATING_TAGS = ["onTime", "careful", "friendly", "communication", "late", "rude", "damaged"] as const;
export type RatingTag = (typeof RATING_TAGS)[number];

/** A dispute reason is stored as its key; older rows may hold free text. */
export function disputeReasonLabel(reason: string, t: T): string {
  return (DISPUTE_REASONS as readonly string[]).includes(reason) ? t(`dispute.reasons.${reason as DisputeReason}`) : reason;
}

/** Timeline line for an engine event. `name` resolves user ids to display names. */
export function describeEvent(code: string, data: Record<string, unknown>, t: T, name: (id: unknown) => string): string {
  const money = (k: string) => fmtMoney(Number(data[k] ?? 0));
  switch (code) {
    case "posted":
      return t("event.posted", { amount: money("amountDue") });
    case "paid":
      return t("event.paid", { amount: money("amount") });
    case "helpers_notified":
      return t(data.mode === "now" ? "event.helpers_notified_now" : "event.helpers_notified_schedule");
    case "accepted":
    case "applied":
    case "chosen":
      return t(`event.${code}`, { name: name(data.helperId) });
    case "receipt_recorded":
      return t("event.receipt_recorded", { amount: money("amount") });
    case "topup_requested":
    case "topup_paid":
      return t(`event.${code}`, { amount: money("amount") });
    case "topup_declined":
      return t("event.topup_declined");
    case "done":
      return t("event.done", { hours: Number(data.checkHours ?? 24) });
    case "released":
      return t(data.how === "auto" ? "event.released_auto" : data.how === "ops" ? "event.released_ops" : "event.released_confirmed");
    case "cancel_fee_paid":
      return t("event.cancel_fee_paid", { amount: money("amount"), name: name(data.helperId) });
    case "refunded":
      return t("event.refunded", { amount: money("amount") });
    case "cancelled":
      return t(data.by === "helper" ? "event.cancelled_helper" : "event.cancelled");
    case "disputed":
      return t("event.disputed", { reason: disputeReasonLabel(String(data.reason ?? ""), t) });
    case "dispute_resolved":
      return t(data.outcome === "refund" ? "event.dispute_resolved_refund" : "event.dispute_resolved_release");
    case "rated":
      return t("event.rated", { stars: Number(data.stars ?? 0) });
    case "started":
    case "handover_recorded":
    case "expired":
    case "payment_expired":
      return t(`event.${code}` as MessageKey);
    default:
      return code;
  }
}
