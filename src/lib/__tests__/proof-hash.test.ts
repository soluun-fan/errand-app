import { describe, expect, it } from "vitest";
import { SIMILAR_BITS, dhashFromGray, grayFromRgba, hamming } from "@/lib/proof-hash";

/** A 9×8 synthetic "photo": a diagonal gradient plus a pattern. */
const photo = (seed: number, brightness = 0) =>
  Array.from({ length: 72 }, (_, i) => {
    const x = i % 9;
    const y = Math.floor(i / 9);
    return Math.max(0, Math.min(255, Math.round(120 + 60 * Math.sin((x + seed) * 1.3) + 40 * Math.cos(y * (seed + 1)) + brightness)));
  });

describe("dHash", () => {
  it("is 16 hex chars and stable", () => {
    const h = dhashFromGray(photo(1));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(dhashFromGray(photo(1))).toBe(h);
  });

  it("survives a brightness change (re-saved / filtered copy)", () => {
    expect(hamming(dhashFromGray(photo(1)), dhashFromGray(photo(1, 25)))).toBeLessThanOrEqual(SIMILAR_BITS);
  });

  it("tells different pictures apart", () => {
    expect(hamming(dhashFromGray(photo(1)), dhashFromGray(photo(4)))).toBeGreaterThan(SIMILAR_BITS);
  });

  it("hamming counts bits; malformed hashes count as totally different", () => {
    expect(hamming("0000000000000000", "000000000000000f")).toBe(4);
    expect(hamming("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hamming("bad", "0000000000000000")).toBe(64);
  });

  it("converts RGBA to luminance", () => {
    expect(grayFromRgba([255, 255, 255, 255, 0, 0, 0, 255])).toEqual([255, 0]);
  });
});
