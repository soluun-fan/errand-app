import { apply } from "./deal";
import type { Command, Deal, Transition } from "./types";

/**
 * What a background job should do with this deal right now, if anything.
 * - check window ended with no complaint → auto_release
 * - "open" errand past its match deadline → expire (full refund)
 */
export function dueCommand(deal: Deal, now: number): Command | null {
  if (deal.status === "check" && deal.checkUntil !== null && now >= deal.checkUntil) return { type: "auto_release" };
  if (deal.type === "errand" && deal.status === "open" && deal.matchBy !== null && now >= deal.matchBy) {
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
