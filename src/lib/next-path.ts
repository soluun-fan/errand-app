/**
 * Where to go after logging in (`/login?next=/post?cat=shop`). Only our own paths: must start
 * with a single "/" — never "//host" or "https://…", so a link can't send people to another site.
 */
export function safeNext(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length > 300) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // browsers drop tabs/newlines and treat "\\" as "/", so "/\t/evil.example" would become "//evil.example"
  if (/[\x00-\x20\x7f\\]/.test(raw) || raw.startsWith("/login") || raw.startsWith("/onboarding")) return fallback;
  // and the final check: resolved against our own origin, it must stay on it
  try {
    if (new URL(raw, "http://guigere.invalid").origin !== "http://guigere.invalid") return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
