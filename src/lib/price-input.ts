/** A price typed by a person ("12 000", "12,000₮") → whole tögrög, or null. Range is the engine's job. */
export function parsePrice(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? "").replace(/[\s,₮]/g, ""));
  return Number.isSafeInteger(n) && n > 0 && n <= 100_000_000 ? n : null;
}
