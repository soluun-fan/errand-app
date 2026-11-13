import type { Account, Deal, LedgerEntry } from "./types";

export const ext = (userId: string): Account => `ext:${userId}`;
export const payable = (userId: string): Account => `payable:${userId}`;

/** Net balance of an account: everything in minus everything out. */
export function balanceOf(ledger: readonly LedgerEntry[], account: Account, dealId?: string): number {
  let sum = 0;
  for (const e of ledger) {
    if (dealId !== undefined && e.dealId !== dealId) continue;
    if (e.to === account) sum += e.amount;
    if (e.from === account) sum -= e.amount;
  }
  return sum;
}

export interface InvariantViolation {
  dealId: string | null;
  message: string;
}

/**
 * Checks the money invariants across a set of deals and their ledger:
 * - every entry is a positive integer between two different accounts
 * - the bank hold account balance == sum of deal.heldAmount
 * - per deal, the hold balance in the ledger == deal.heldAmount
 * - closed deals hold nothing
 * Returns an empty array when everything balances.
 */
export function checkInvariants(deals: readonly Deal[], ledger: readonly LedgerEntry[]): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const e of ledger) {
    if (!Number.isSafeInteger(e.amount) || e.amount <= 0) {
      out.push({ dealId: e.dealId, message: `ledger entry ${e.kind} has non-positive or non-integer amount ${e.amount}` });
    }
    if (e.from === e.to) out.push({ dealId: e.dealId, message: `ledger entry ${e.kind} moves money to itself` });
  }

  const totalHeld = deals.reduce((a, d) => a + d.heldAmount, 0);
  const holdBalance = balanceOf(ledger, "hold");
  if (holdBalance !== totalHeld) {
    out.push({ dealId: null, message: `hold account ${holdBalance} != sum of held ${totalHeld}` });
  }

  for (const d of deals) {
    const b = balanceOf(ledger, "hold", d.id);
    if (b !== d.heldAmount) out.push({ dealId: d.id, message: `hold balance ${b} != heldAmount ${d.heldAmount}` });
    if (["released", "refunded", "cancelled", "expired"].includes(d.status) && d.heldAmount !== 0) {
      out.push({ dealId: d.id, message: `closed deal (${d.status}) still holds ${d.heldAmount}` });
    }
  }
  return out;
}
