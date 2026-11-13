import { assertMoney, fail } from "./errors";
import { ext, payable } from "./ledger";
import type { LedgerEntry } from "./types";

/** Normalise a person's name for comparison: trim, collapse spaces, case-fold (Cyrillic-safe), drop dots. */
export function normalizeName(name: string): string {
  return name.normalize("NFC").replace(/\./g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("mn");
}

export function namesMatch(a: string, b: string): boolean {
  return normalizeName(a) !== "" && normalizeName(a) === normalizeName(b);
}

export interface PayoutAccount {
  /** Account holder name as reported by the bank. */
  holderName: string;
  bankRef: string;
}

/**
 * Withdraw a helper/seller balance to their own bank account.
 * Payouts go only to an account in the user's own ДАН-verified name; anything else is blocked
 * and the money stays in `payable:<userId>`.
 */
export function withdraw(input: {
  userId: string;
  verifiedName: string;
  available: number;
  amount: number;
  account: PayoutAccount;
  now: number;
  providerRef?: string;
}): LedgerEntry {
  const { userId, verifiedName, available, amount, account, now } = input;
  assertMoney(available, "available");
  assertMoney(amount, "amount");
  if (amount === 0) fail("INVALID_INPUT", "Nothing to withdraw");
  if (amount > available) fail("INVALID_INPUT", `Cannot withdraw ${amount}, only ${available} available`);
  if (!namesMatch(account.holderName, verifiedName)) {
    fail("PAYOUT_BLOCKED", "Payout account name does not match the verified (ДАН) name");
  }
  return {
    dealId: null,
    kind: "withdrawal",
    amount,
    from: payable(userId),
    to: ext(userId),
    providerRef: input.providerRef ?? null,
    at: now,
  };
}
