/**
 * Legal documents and their versions (docs/decisions.md 2026-11-18 "Registration and terms"). Change
 * a version when the text changes in a way people must agree to again: everyone is asked to accept
 * the new one before going on. Pure: used by pages, actions, tests and the browser tests.
 */
export const LEGAL_VERSIONS = {
  terms: "2026-11-19",
  privacy: "2026-11-26", // the age range kept from a checked ID; customer ID checks for home jobs
  helper: "2026-11-19",
} as const;
export type LegalDoc = keyof typeof LEGAL_VERSIONS;

/** A display name people will see: 2–40 letters, spaces, dots, hyphens (no phone numbers or links). */
export function cleanDisplayName(raw: string): string | null {
  const v = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  // a dot straight before a letter reads as a web address ("www.x.mn"), not an initial ("Bat B.")
  return v.length >= 2 && v.length <= 40 && /^[\p{L}][\p{L}\s.'-]*$/u.test(v) && !/\.\p{L}/u.test(v) ? v : null;
}

export interface OnboardingState {
  name: string | null;
  age_confirmed_at: string | null;
  terms_version: string | null;
  privacy_version: string | null;
}

/** What a signed-in person still has to do before using the app (empty = nothing). */
export function onboardingMissing(p: OnboardingState): ("name" | "age" | "terms" | "privacy")[] {
  const out: ("name" | "age" | "terms" | "privacy")[] = [];
  if (!p.name || !cleanDisplayName(p.name)) out.push("name");
  if (!p.age_confirmed_at) out.push("age");
  if (p.terms_version !== LEGAL_VERSIONS.terms) out.push("terms");
  if (p.privacy_version !== LEGAL_VERSIONS.privacy) out.push("privacy");
  return out;
}

/** Registration finished (name, date of birth, current Terms + Privacy) — server actions check it too. */
export const isOnboarded = (p: { name: string | null; age_confirmed_at?: string | null; terms_version?: string | null; privacy_version?: string | null }) =>
  onboardingMissing({ name: p.name, age_confirmed_at: p.age_confirmed_at ?? null, terms_version: p.terms_version ?? null, privacy_version: p.privacy_version ?? null }).length === 0;
