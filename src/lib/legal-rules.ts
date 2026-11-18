/**
 * Legal documents and their versions (docs/decisions.md 2026-11-18 "Registration and terms"). Change
 * a version when the text changes in a way people must agree to again: everyone is asked to accept
 * the new one before going on. Pure: used by pages, actions, tests and the browser tests.
 */
export const LEGAL_VERSIONS = {
  terms: "2026-11-18",
  privacy: "2026-11-18",
  helper: "2026-11-18",
} as const;
export type LegalDoc = keyof typeof LEGAL_VERSIONS;

export const MIN_AGE = 18;

/** 18 or older on `today` (both "YYYY-MM-DD", Ulaanbaatar calendar). */
export function isAdultOn(birthDate: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const born = new Date(Date.UTC(by, bm - 1, bd));
  if (born.getUTCFullYear() !== by || born.getUTCMonth() !== bm - 1 || born.getUTCDate() !== bd) return false; // e.g. 2000-02-31
  if (by < 1900 || birthDate > today) return false;
  const age = ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
  return age >= MIN_AGE;
}

/** Today in Ulaanbaatar as "YYYY-MM-DD". */
export function ubToday(now = Date.now()): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** A display name people will see: 2–40 letters, spaces, dots, hyphens (no phone numbers or links). */
export function cleanDisplayName(raw: string): string | null {
  const v = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  // a dot straight before a letter reads as a web address ("www.x.mn"), not an initial ("Bat B.")
  return v.length >= 2 && v.length <= 40 && /^[\p{L}][\p{L}\s.'-]*$/u.test(v) && !/\.\p{L}/u.test(v) ? v : null;
}

export interface OnboardingState {
  name: string | null;
  birth_date: string | null;
  terms_version: string | null;
  privacy_version: string | null;
}

/** What a signed-in person still has to do before using the app (empty = nothing). */
export function onboardingMissing(p: OnboardingState): ("name" | "birth" | "terms" | "privacy")[] {
  const out: ("name" | "birth" | "terms" | "privacy")[] = [];
  if (!p.name || !cleanDisplayName(p.name)) out.push("name");
  if (!p.birth_date) out.push("birth");
  if (p.terms_version !== LEGAL_VERSIONS.terms) out.push("terms");
  if (p.privacy_version !== LEGAL_VERSIONS.privacy) out.push("privacy");
  return out;
}

/** Registration finished (name, date of birth, current Terms + Privacy) — server actions check it too. */
export const isOnboarded = (p: { name: string | null; birth_date?: string | null; terms_version?: string | null; privacy_version?: string | null }) =>
  onboardingMissing({ name: p.name, birth_date: p.birth_date ?? null, terms_version: p.terms_version ?? null, privacy_version: p.privacy_version ?? null }).length === 0;
