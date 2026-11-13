import { describe, expect, it } from "vitest";
import { CITY_WAVE, WAVES, bayesRating, dueWave, pickWave, score, type Candidate } from "../plan";

const c = (helperId: string, distanceKm: number | null, o: Partial<Candidate> = {}): Candidate => ({
  helperId,
  distanceKm,
  ratingSum: 0,
  ratingCount: 0,
  completed: 0,
  offers30d: 0,
  won30d: 0,
  ...o,
});

describe("score: close and good", () => {
  it("prefers the closer helper when they are otherwise equal", () => {
    expect(score(c("a", 0.5))).toBeGreaterThan(score(c("b", 3)));
  });

  it("a well-rated helper 1.5 km away beats a poorly rated one next door", () => {
    const good = c("good", 1.5, { ratingSum: 49 * 20, ratingCount: 49 * 4, completed: 120, offers30d: 20, won30d: 16 }); // ~5★
    const poor = c("poor", 0.2, { ratingSum: 3 * 40, ratingCount: 40, completed: 40, offers30d: 30, won30d: 3 }); // 3★, ignores offers
    expect(score(good)).toBeGreaterThan(score(poor));
  });

  it("one 5★ rating doesn't outrank a long 4.9★ record", () => {
    expect(bayesRating(5, 1)).toBeLessThan(bayesRating(4.9 * 200, 200));
  });

  it("new helpers get a fair start (no zero for having no history)", () => {
    expect(score(c("new", 1))).toBeGreaterThan(0.3);
  });
});

describe("pickWave", () => {
  const pool = [c("near", 0.8), c("mid", 3.5), c("far", 8), c("nopin", null), c("near2", 1.9)];

  it("wave 0 only reaches helpers within 2 km, best first, at most 5", () => {
    expect(pickWave(pool, 0, new Set()).map((x) => x.helperId)).toEqual(["near", "near2"]);
    const many = Array.from({ length: 9 }, (_, i) => c(`h${i}`, 0.1 * i));
    expect(pickWave(many, 0, new Set())).toHaveLength(WAVES[0].max);
  });

  it("later waves widen and never re-offer the same helper", () => {
    expect(pickWave(pool, 1, new Set(["near", "near2"])).map((x) => x.helperId)).toEqual(["mid"]);
    expect(pickWave(pool, 2, new Set(["near", "near2", "mid"])).map((x) => x.helperId)).toEqual(["far"]);
  });

  it("helpers or tasks without a position are reached only city-wide", () => {
    expect(pickWave(pool, 2, new Set()).map((x) => x.helperId)).not.toContain("nopin");
    expect(pickWave(pool, CITY_WAVE, new Set(["near", "near2", "mid", "far"])).map((x) => x.helperId)).toEqual(["nopin"]);
  });
});

describe("dueWave", () => {
  const T = 1_000_000;
  it("starts with wave 0, waits out each wave, stops after the city-wide wave", () => {
    expect(dueWave(-1, null, T)).toBe(0);
    expect(dueWave(0, T, T + 44_000)).toBeNull();
    expect(dueWave(0, T, T + 45_000)).toBe(1);
    expect(dueWave(2, T, T + 60_000)).toBe(3);
    expect(dueWave(CITY_WAVE, T, T + 10 ** 9)).toBeNull();
  });
});
