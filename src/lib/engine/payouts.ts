import { assertMoney, fail } from "./errors";
import { ext, payable } from "./ledger";
import type { LedgerEntry } from "./types";

/** Normalise a person's name for comparison: trim, collapse spaces, case-fold (Cyrillic-safe), drop dots. */
export function normalizeName(name: string): string {
  return name.normalize("NFC").replace(/\./g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("mn");
}

// Mongolian Cyrillic → Latin (MNS 5217:2012, as banks and passports use it)
const LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m",
  н: "n", о: "o", ө: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ү: "u", ф: "f", х: "kh", ц: "ts", ч: "ch",
  ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "i", э: "e", ю: "yu", я: "ya",
};
const cyrillic = (w: string) => /[а-яёөү]/.test(w);
/**
 * How a name part sounds, for comparing Cyrillic with Latin: practice mixes ө/ү/у (o, u, ö, ü),
 * х (kh, h), ц (ts, c) and в (v, w) (NUM translation-studies journal), so those collapse together,
 * and doubled letters count once.
 */
function sound(w: string): string {
  const latin = cyrillic(w) ? [...w].map((c) => LATIN[c] ?? c).join("") : w;
  return latin
    .replace(/[öő]/g, "o")
    .replace(/[üű]/g, "u")
    .replace(/kh/g, "h")
    .replace(/ts/g, "c")
    .replace(/w/g, "v")
    .replace(/u/g, "o")
    .replace(/y/g, "i")
    .replace(/(.)\1+/g, "$1");
}
const parts = (name: string) =>
  normalizeName(name)
    .replace(/ё/g, "е")
    .split(" ")
    .map((w) => w.replace(/-/g, ""))
    .filter(Boolean);

/**
 * The same person? (owner 2026-11-26: banks write "СОЛУУН ЭНХТАЙВАН" where the ID says "Энхтайван
 * Солуун"). The order of the parts doesn't matter; a single letter stands for a part that starts with
 * it ("Э. Солуун"); case, dots, hyphens and spacing don't count; Cyrillic and Latin are compared by
 * sound. Both names need the same number of parts and at least one part written out in full on both.
 */
export function namesMatch(a: string, b: string): boolean {
  const A = parts(a);
  const B = parts(b);
  if (!A.length || A.length !== B.length) return false;
  const key = (w: string) => (cyrillic(w) === cyrillic(A[0]) && cyrillic(w) === cyrillic(B[0]) ? w : sound(w));
  const left = [...B];
  let full = 0;
  for (const w of A) {
    // a written-out part first, then an initial on either side
    let i = left.findIndex((v) => v.length > 1 && w.length > 1 && key(v) === key(w));
    if (i >= 0) full++;
    else i = left.findIndex((v) => (v.length === 1 || w.length === 1) && key(v)[0] === key(w)[0]);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return full > 0;
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
