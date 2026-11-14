/**
 * Helper verification rules (docs/decisions.md 2026-11-15) — pure, unit-tested.
 * Ops checks documents by hand (no ДАН integration yet); these rules make the form honest and the
 * stored data minimal.
 */
import { namesMatch } from "@/lib/engine/payouts";

export const KYC_DOCS = ["id_front", "id_back", "selfie", "record"] as const;
export type KycDoc = (typeof KYC_DOCS)[number];
/** ID / certificate images are deleted this long after Ops decides. */
export const KYC_RETENTION_DAYS = 30;
export const MIN_AGE = 18;
/** kyc_level after approval: 3 = ID + selfie + payout checked; 4 = also criminal-record certificate. */
export const KYC_LEVEL_VERIFIED = 3;
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

/** Account number as stored: an "MN" + 18-digit IBAN, or 6–20 digits; spaces / dashes removed. */
export function normalizeAccount(raw: string): string | null {
  const v = raw.toUpperCase().replace(/[\s-]/g, "");
  return /^(MN\d{18}|\d{6,20})$/.test(v) ? v : null;
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
