/**
 * Dispatch planning (docs/rules.md §Dispatch) — pure, no I/O, so it is unit-tested.
 *
 * An open task goes out in waves, UBCab-style: the best few helpers nearby first, then wider.
 * "Best" = close *and* good: distance dominates, then rating, then reliability and experience.
 */

export interface Wave {
  /** Max distance from the task pin (km). The last wave is city-wide. */
  radiusKm: number;
  /** At most this many helpers are offered the task in this wave. */
  max: number;
  /** How long this wave has the task to itself before the next wave goes out. */
  seconds: number;
}

export const WAVES: readonly Wave[] = [
  { radiusKm: 2, max: 5, seconds: 45 },
  { radiusKm: 5, max: 10, seconds: 45 },
  { radiusKm: 10, max: 25, seconds: 60 }, // roughly a district
  { radiusKm: 1000, max: 100, seconds: 0 }, // city-wide; the task then waits in feeds
];
export const CITY_WAVE = WAVES.length - 1;

export interface Candidate {
  helperId: string;
  /** null when the task or the helper has no position (only reached by the city-wide wave). */
  distanceKm: number | null;
  ratingSum: number;
  ratingCount: number;
  completed: number;
  /** Offers received / won in the last 30 days (reliability). */
  offers30d: number;
  won30d: number;
}

/** Rating with a prior (4.5★ worth 5 ratings), so one 5★ doesn't beat 200 ratings at 4.9★. */
export function bayesRating(sum: number, count: number): number {
  const PRIOR = 4.5;
  const WEIGHT = 5;
  return (sum + PRIOR * WEIGHT) / (count + WEIGHT);
}

/**
 * Higher is better, 0..1.
 * - distance 55%: 1 at the door, 0.5 at 1.5 km, ~0.13 at 10 km
 * - rating 25%: 3★ → 0, 5★ → 1
 * - reliability 10%: share of offers turned into jobs (with a prior, new helpers start at 0.5)
 * - experience 10%: grows with completed jobs, saturates around 50
 */
export function score(c: Candidate): number {
  const distance = c.distanceKm === null ? 0.1 : 1 / (1 + c.distanceKm / 1.5);
  const rating = Math.min(1, Math.max(0, (bayesRating(c.ratingSum, c.ratingCount) - 3) / 2));
  const reliability = (c.won30d + 1) / (c.offers30d + 2);
  const experience = Math.min(1, Math.log1p(c.completed) / Math.log1p(50));
  return 0.55 * distance + 0.25 * rating + 0.1 * reliability + 0.1 * experience;
}

/** The helpers to offer the task to in `wave`: not offered before, best first. */
export function pickWave(candidates: readonly Candidate[], wave: number, alreadyOffered: ReadonlySet<string>) {
  const w = WAVES[wave];
  return candidates
    .filter((c) => !alreadyOffered.has(c.helperId))
    .filter((c) => (c.distanceKm === null ? wave === CITY_WAVE : c.distanceKm <= w.radiusKm))
    .map((c) => ({ ...c, score: score(c) }))
    .sort((a, b) => b.score - a.score || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.helperId.localeCompare(b.helperId))
    .slice(0, w.max);
}

/**
 * Which wave should go out now, or null if the current one still has time.
 * `current` is the last wave sent (-1 = none yet).
 */
export function dueWave(current: number, startedAt: number | null, now: number): number | null {
  if (current < 0 || startedAt === null) return 0;
  if (current >= CITY_WAVE) return null;
  return now >= startedAt + WAVES[current].seconds * 1000 ? current + 1 : null;
}
