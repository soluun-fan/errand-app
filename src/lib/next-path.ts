/**
 * Where to go after logging in (`/login?next=/post?cat=shop`). Only our own paths: must start
 * with a single "/" — never "//host" or "https://…", so a link can't send people to another site.
 */
export function safeNext(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length > 300) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(raw) || raw.startsWith("/login")) return fallback;
  return raw;
}
