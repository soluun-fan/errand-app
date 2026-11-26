/**
 * Helper verification rules (docs/decisions.md 2026-11-18) — pure, unit-tested.
 * Ops checks documents by hand (no ДАН integration yet); these rules make the form honest and the
 * stored data minimal.
 */
import { namesMatch } from "@/lib/engine/payouts";
import type { CategoryId } from "@/lib/engine/config";

export const KYC_DOCS = ["id_front", "id_back", "selfie"] as const;
export type KycDoc = (typeof KYC_DOCS)[number];
/** ID images are deleted this long after Ops decides. */
export const KYC_RETENTION_DAYS = 30;
export const MIN_AGE = 18;
/** kyc_level after identity approval; bank ownership requires a separate check. Level 4 is legacy care data. */
export const KYC_LEVEL_VERIFIED = 3;
/** Legacy care qualification only; not collected or shown as a general badge for new helpers. */
export const KYC_LEVEL_BACKGROUND = 4;

export const BANKS = ["Хаан банк", "Голомт банк", "Худалдаа хөгжлийн банк", "Төрийн банк", "Хас банк", "Богд банк", "Капитрон банк", "М банк", "Ариг банк", "Тээвэр хөгжлийн банк", "Үндэсний хөрөнгө оруулалтын банк", "Чингис хаан банк"] as const;

/** Full years between birth and `now` (UB dates; good enough for an 18+ gate). */
export function ageOn(birth: Date, now: Date): number {
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

export function isAdult(birthIso: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthIso)) return false;
  const b = new Date(`${birthIso}T00:00:00Z`);
  if (Number.isNaN(b.getTime()) || b > now || b.getUTCFullYear() < 1920) return false;
  return ageOn(b, now) >= MIN_AGE;
}

/**
 * A payout account as an IBAN only (owner 2026-11-26): Mongolian banks moved to IBAN from 1 April 2025.
 * "MN", 2 check digits and 16 digits — 20 characters; spaces, dashes and a lowercase "mn" are tidied.
 * The ISO 13616 check digits must hold (catches typos). It does NOT prove the account exists or whose it is.
 */
export function normalizeAccount(raw: string): string | null {
  const v = raw.toUpperCase().replace(/[\s-]/g, "");
  if (!/^MN\d{18}$/.test(v)) return null;
  // ISO 13616 / MOD97-10: move the prefix to the end, M = 22, N = 23.
  // Keep each step small instead of rounding a 24-digit number through Number.
  const digits = `${v.slice(4)}2223${v.slice(2, 4)}`;
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1 ? v : null;
}
/** A valid Mongolian IBAN from a 4-digit bank code and the account digits (seed data and tests). */
export function ibanFor(bankCode: string, account: string): string {
  const bban = `${bankCode.replace(/\D/g, "").padStart(4, "0")}${account.replace(/\D/g, "").padStart(12, "0")}`.slice(-16);
  let remainder = 0;
  for (const digit of `${bban}222300`) remainder = (remainder * 10 + Number(digit)) % 97;
  return `MN${String(98 - remainder).padStart(2, "0")}${bban}`;
}

/**
 * Each bank's 4-digit code inside a Mongolian IBAN (Mongolbank's payment-system participant list,
 * checked 2026-11-26). Чингис хаан банк is left out until its code is confirmed (likely 0033): its
 * customers type the full IBAN.
 */
export const BANK_CODES: Partial<Record<(typeof BANKS)[number], string>> = {
  "Худалдаа хөгжлийн банк": "0004",
  "Хаан банк": "0005",
  "Голомт банк": "0015",
  "Тээвэр хөгжлийн банк": "0019",
  "Ариг банк": "0021",
  "Үндэсний хөрөнгө оруулалтын банк": "0029",
  "Капитрон банк": "0030",
  "Хас банк": "0032",
  "Төрийн банк": "0034",
  "Богд банк": "0038",
  "М банк": "0039",
};

/**
 * The account a person typed, as an IBAN (owner 2026-11-26: "some people don't have those memorised").
 * Either the IBAN itself — whose bank code must then match the chosen bank — or the ordinary account
 * number, which Mongolbank's IBAN wraps unchanged: "MN" + check digits + bank code + the account
 * number padded to 12 digits. The result is shown back so the person can compare it with their bank app,
 * and Ops still checks the account before any money is sent.
 */
export function accountToIban(raw: string, bank: string): { iban: string; built: boolean } | { error: "format" | "bank" } {
  const typed = raw.toUpperCase().replace(/[\s-]/g, "");
  const code = BANK_CODES[bank as (typeof BANKS)[number]];
  if (typed.startsWith("MN")) {
    const iban = normalizeAccount(typed);
    if (!iban) return { error: "format" };
    if (code && iban.slice(4, 8) !== code) return { error: "bank" };
    return { iban, built: false };
  }
  if (!code || !/^\d{5,12}$/.test(typed)) return { error: "format" };
  return { iban: ibanFor(code, typed), built: true };
}

export function maskAccount(acct: string): string {
  return `•••• ${acct.slice(-4)}`;
}

/** The payout account must be in the same name as the ID (no paying someone else). */
export function payoutNameOk(legalName: string, holderName: string): boolean {
  return namesMatch(legalName, holderName);
}

/**
 * A person's name as on their Mongolian ID card (owner 2026-11-26): Mongolian Cyrillic only (with Ө, Ү),
 * spaces, hyphens and dots, at least two words (овог + нэр). Used for what people type about themselves:
 * the legal name and their own bank account's holder name. A bank-reported name may be Latin — that one
 * still goes through cleanLegalName.
 */
export function cleanCyrillicName(raw: string): string | null {
  const v = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (v.length < 3 || v.length > 80 || !/^[А-ЯЁӨҮа-яёөү .-]+$/u.test(v)) return null;
  const words = v.split(" ").filter((w) => /[А-ЯЁӨҮа-яёөү]/u.test(w));
  return words.length >= 2 ? v : null;
}

export function cleanLegalName(raw: string): string | null {
  const v = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  return v.length >= 3 && v.length <= 80 && /^[\p{L}\s.'-]+$/u.test(v) ? v : null;
}


/**
 * Jobs where a helper enters a private home or goes with a person (owner 2026-11-26): the customer
 * must have a checked ID before posting them. Everyday errands outside the home don't need it.
 */
export const ID_CHECK_KINDS: readonly CategoryId[] = ["repair", "assembly", "plumbing", "electrical", "cleaning", "childcare", "eldercare", "escort"];

/** Must this customer verify their ID before posting this kind? Never while ID review is switched off (private test). */
export const needsIdCheck = (category: CategoryId, kycLevel: number, idReviewOn: boolean): boolean =>
  idReviewOn && ID_CHECK_KINDS.includes(category) && kycLevel < KYC_LEVEL_VERIFIED;
