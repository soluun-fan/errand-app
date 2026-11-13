/**
 * Mongolian phone numbers: 8 digits, country code 976.
 * Accepts "8800 0001", "88000001", "+976 8800-0001", "97688000001".
 * Returns E.164 ("+97688000001") or null if it isn't a valid Mongolian number.
 */
export function normalizeMnPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;
  const local = digits.length === 11 && digits.startsWith("976") ? digits.slice(3) : digits;
  if (!/^[5-9]\d{7}$/.test(local)) return null;
  return `+976${local}`;
}

/** "+97688000001" → "8800 0001" for display. */
export function formatMnPhone(e164: string): string {
  const local = e164.replace(/^\+?976/, "");
  return local.length === 8 ? `${local.slice(0, 4)} ${local.slice(4)}` : e164;
}
