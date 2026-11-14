import type { FeeTier } from "@/lib/engine";

/**
 * Pure checks for the live pricing settings (docs/decisions.md 2026-11-15 "Pricing"), shared by the
 * Ops form and the loader. Bad settings must never reach the price a customer sees.
 */

/** Tiers must ascend and end open-ended, with whole-tögrög fees; otherwise null. */
export function cleanTiers(raw: unknown): FeeTier[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return null;
  const tiers: FeeTier[] = [];
  let last = 0;
  for (const [i, t] of raw.entries()) {
    const below = (t as FeeTier | null)?.below;
    const fee = (t as FeeTier | null)?.fee;
    if (!Number.isInteger(fee) || (fee as number) < 0 || (fee as number) > 100_000) return null;
    const isLast = i === raw.length - 1;
    if (isLast ? below !== null : !(Number.isInteger(below) && (below as number) > last)) return null;
    if (!isLast) last = below as number;
    tiers.push({ below: isLast ? null : (below as number), fee: fee as number });
  }
  return tiers;
}

/** Whole tögrög in [min, max], from a form field ("5,000₮" allowed); otherwise null. */
export function wholeAmount(v: unknown, min: number, max: number): number | null {
  const n = Number(String(v ?? "").replace(/[\s,₮%]/g, ""));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** "20" (%) → 2000 basis points, within [0, maxPct]; otherwise null. */
export function percentToBps(v: unknown, maxPct: number): number | null {
  const n = wholeAmount(v, 0, maxPct);
  return n === null ? null : n * 100;
}
