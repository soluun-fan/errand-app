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

/** Normalise account syntax. IBAN checksum validation does NOT prove existence or ownership. */
export function normalizeAccount(raw: string): string | null {
  const v = raw.toUpperCase().replace(/[\s-]/g, "");
  if (/^\d{6,20}$/.test(v)) return v; // legacy domestic numbers need a bank lookup
  if (!/^MN\d{18}$/.test(v)) return null;
  // ISO 13616 / MOD97-10: move the prefix to the end, M = 22, N = 23.
  // Keep each step small instead of rounding a 24-digit number through Number.
  const digits = `${v.slice(4)}2223${v.slice(2, 4)}`;
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1 ? v : null;
}

export function maskAccount(acct: string): string {
  return `•••• ${acct.slice(-4)}`;
}

/** The payout account must be in the same name as the ID (no paying someone else). */
export function payoutNameOk(legalName: string, holderName: string): boolean {
  return namesMatch(legalName, holderName);
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
