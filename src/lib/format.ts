import { intlLocale, type Locale, type T } from "@/i18n";

/** Ulaanbaatar is UTC+8 all year (no daylight saving). */
export const UB_TZ = "Asia/Ulaanbaatar";
const UB_OFFSET = "+08:00";

/** 46,000₮ — number then ₮, comma grouping, no decimals; the format UB apps use (docs/ui.md). */
export const fmtMoney = (n: number) => `${Math.round(n).toLocaleString("en-US")}₮`;

export function fmtDateTime(ms: number, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: UB_TZ,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
}

/** "14:02" in Ulaanbaatar time — used under finished tracker steps. */
export function fmtClock(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: UB_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

/** "3h 20m" / "3 цаг 20 мин" */
export function fmtDuration(ms: number, t: T): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? t("time.hm", { h, m }) : t("time.m", { m });
}

/** "23:59:12" or "29:41" — countdown clock, language-neutral. */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** <input type="datetime-local"> value ("2026-11-14T15:00") is Ulaanbaatar wall time. */
export function parseUbLocal(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00${UB_OFFSET}`);
  return Number.isNaN(ms) ? null : ms;
}

/** Inverse of parseUbLocal, for min= / default values. */
export function toUbLocal(ms: number): string {
  return new Date(ms + 8 * 3_600_000).toISOString().slice(0, 16);
}
