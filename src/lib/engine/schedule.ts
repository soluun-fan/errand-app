import { HOUR_MS, MINUTE_MS } from "./config";
import { apply, ruleOf } from "./deal";
import type { Command, Deal, Transition } from "./types";

/**
 * What a background job should do with this deal right now, if anything.
 * - check window ended with no complaint → auto_release
 * - "open" errand past its match deadline → expire (nothing held; legacy prepaid deals are refunded)
 * - matched but unpaid past its payment window → expire (helper released; back to searching, or expired)
 */
export function dueCommand(deal: Deal, now: number): Command | null {
  // after "done", an open partial-refund offer holds the release; unanswered for long, Ops decides
  if (deal.type === "errand" && deal.status === "check" && deal.priceChange?.status === "proposed") {
    return now >= deal.priceChange.at + ruleOf(deal, "settleHours") * HOUR_MS ? { type: "escalate_offer" } : null;
  }
  if (deal.status === "check" && deal.checkUntil !== null && now >= deal.checkUntil) return { type: "auto_release" };
  // "customer isn't here" and no answer in time: cancelled, the helper is paid the trip
  if (deal.type === "errand" && deal.status === "in_progress" && deal.absentAt && now >= deal.absentAt + ruleOf(deal, "absentGraceMinutes") * MINUTE_MS) {
    return { type: "absent_cancel" };
  }
  if (deal.type === "errand" && deal.status === "open" && deal.matchBy !== null && now >= deal.matchBy) {
    return { type: "expire" };
  }
  if (deal.type === "errand" && deal.status === "awaiting_payment" && deal.payBy !== null && now >= deal.payBy) {
    return { type: "expire" };
  }
  return null;
}

/**
 * Runs the due command for one deal as the system actor. Returns null when nothing is due,
 * so running the job twice is harmless: the second run finds the deal already closed.
 */
export function runDue<D extends Deal>(deal: D, now: number): Transition<D> | null {
  const cmd = dueCommand(deal, now);
  return cmd ? apply(deal, cmd, { now, actor: { kind: "system" } }) : null;
}
