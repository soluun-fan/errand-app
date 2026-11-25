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
  /** Helper standards (2026-11-22): subtracted when their record says "ranked lower". */
  penalty?: number;
}

/** Rating with a prior (4.5★ worth 5 ratings), so one 5★ doesn't beat 200 ratings at 4.9★. */
export function bayesRating(sum: number, count: number): number {
  const PRIOR = 4.5;
  const WEIGHT = 5;
  return (sum + PRIOR * WEIGHT) / (count + WEIGHT);
}

/**
 * What "best" means depends on the job (owner, 2026-11-25: "the closest one … with better rated ones
 * after"): for a job that needs someone **now** speed wins, so distance leads; for a **planned** job
 * — booked for later, or work in someone's home or with a person — trust matters more than a
 * kilometre, so rating and experience lead.
 */
export type RankProfile = "now" | "planned";
export const RANK_WEIGHTS: Record<RankProfile, { distance: number; rating: number; reliability: number; experience: number }> = {
  now: { distance: 0.6, rating: 0.2, reliability: 0.1, experience: 0.1 },
  planned: { distance: 0.25, rating: 0.4, reliability: 0.15, experience: 0.2 },
};

/** Work at someone's home or with a person: chosen on trust even when it's for right now. */
const IN_HOME = new Set(["repair", "assembly", "cleaning", "plumbing", "electrical", "escort", "childcare", "eldercare"]);

export function rankProfile(task: { scheduledAt: number | null; mode: string; category: string }): RankProfile {
  return task.scheduledAt === null && task.mode !== "schedule" && !IN_HOME.has(task.category) ? "now" : "planned";
}

/**
 * Higher is better, 0..1 (minus any standards penalty). Parts, each 0..1:
 * - distance: 1 at the door, 0.5 at 1.5 km, ~0.13 at 10 km
 * - rating: 3★ → 0, 5★ → 1 (with a prior, see `bayesRating`)
 * - reliability: share of offers turned into jobs (with a prior, new helpers start at 0.5)
 * - experience: grows with completed jobs, saturates around 50
 */
export function score(c: Candidate, profile: RankProfile = "now"): number {
  const w = RANK_WEIGHTS[profile];
  const distance = c.distanceKm === null ? 0.1 : 1 / (1 + c.distanceKm / 1.5);
  const rating = Math.min(1, Math.max(0, (bayesRating(c.ratingSum, c.ratingCount) - 3) / 2));
  const reliability = (c.won30d + 1) / (c.offers30d + 2);
  const experience = Math.min(1, Math.log1p(c.completed) / Math.log1p(50));
  return w.distance * distance + w.rating * rating + w.reliability * reliability + w.experience * experience - (c.penalty ?? 0);
}

/** Why the first applicant is recommended: the parts where they lead the others. */
export type RecommendReason = "closest" | "bestRated" | "mostJobs";

export function recommendReasons(ranked: readonly { distanceKm: number | null; rating: number; ratingCount: number; completed: number }[]): RecommendReason[] {
  const [top, ...rest] = ranked;
  if (!top || rest.length === 0) return [];
  const reasons: RecommendReason[] = [];
  if (top.distanceKm !== null && rest.every((r) => r.distanceKm === null || r.distanceKm >= top.distanceKm!)) reasons.push("closest");
  if (top.ratingCount > 0 && rest.every((r) => r.rating <= top.rating)) reasons.push("bestRated");
  if (top.completed > 0 && rest.every((r) => r.completed <= top.completed)) reasons.push("mostJobs");
  return reasons;
}

/** The helpers to offer the task to in `wave`: not offered before, best first. */
export function pickWave(
  candidates: readonly Candidate[],
  wave: number,
  alreadyOffered: ReadonlySet<string>,
  waves: readonly Wave[] = WAVES,
  profile: RankProfile = "now",
) {
  const w = waves[wave];
  return candidates
    .filter((c) => !alreadyOffered.has(c.helperId))
    // helpers or tasks without a position are only reached by the last (widest) wave
    .filter((c) => (c.distanceKm === null ? wave === waves.length - 1 : c.distanceKm <= w.radiusKm))
    .map((c) => ({ ...c, score: score(c, profile) }))
    .sort((a, b) => b.score - a.score || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.helperId.localeCompare(b.helperId))
    .slice(0, w.max);
}

/**
 * Which wave should go out now, or null if the current one still has time.
 * `current` is the last wave sent (-1 = none yet).
 */
export function dueWave(current: number, startedAt: number | null, now: number, waves: readonly Wave[] = WAVES): number | null {
  if (current < 0 || startedAt === null) return 0;
  if (current >= waves.length - 1) return null;
  return now >= startedAt + waves[current].seconds * 1000 ? current + 1 : null;
}

/** Great-circle distance in km (same formula as the SQL in dispatch_candidates). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
