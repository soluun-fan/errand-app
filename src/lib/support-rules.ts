/** Help & contact (2026-11-23), pure part. */
export const SUPPORT_TOPICS = ["payment", "task", "helper", "account", "other"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export const SUPPORT_MIN = 10;
export const SUPPORT_MAX = 1000;
/** At most this many messages a person can send in a day (stops spam reaching Ops' phones). */
export const SUPPORT_PER_DAY = 5;

export function checkSupport(topic: string, message: string): { ok: true; topic: SupportTopic; message: string } | { ok: false; reason: "topic" | "short" | "long" } {
  if (!(SUPPORT_TOPICS as readonly string[]).includes(topic)) return { ok: false, reason: "topic" };
  const m = message.replace(/\s+/g, " ").trim();
  if (m.length < SUPPORT_MIN) return { ok: false, reason: "short" };
  if (m.length > SUPPORT_MAX) return { ok: false, reason: "long" };
  return { ok: true, topic: topic as SupportTopic, message: m };
}

/** Facebook link from what Ops typed: a full https URL on facebook.com / fb.com / m.me only. */
export function cleanFacebook(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && /(^|\.)(facebook\.com|fb\.com|m\.me)$/.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}
