/**
 * Perceptual "difference hash" (dHash) for photo proof: shrink to 9×8 grayscale, compare each
 * pixel with its right neighbour → 64 bits. Re-saved, resized or lightly edited copies of the same
 * picture land within a few bits; different photos differ in ~half. Pure — runs in the browser
 * (from canvas pixels) and on the server (comparisons).
 */

/** `gray` is 9×8 luminance values, row-major (72 numbers 0–255). Returns 16 hex chars. */
export function dhashFromGray(gray: ArrayLike<number>): string {
  if (gray.length !== 72) throw new Error("dHash needs a 9×8 grayscale image");
  let hex = "";
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const left = gray[row * 9 + col];
      const right = gray[row * 9 + col + 1];
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Number of differing bits between two 16-hex-char hashes. */
export function hamming(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) return 64;
  let d = 0;
  for (let i = 0; i < 16; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** At or below this many differing bits, two photos are treated as the same picture. */
export const SIMILAR_BITS = 6;

/** RGBA pixels (from a 9×8 canvas) → luminance (Rec. 601). */
export function grayFromRgba(rgba: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) out.push(Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]));
  return out;
}
