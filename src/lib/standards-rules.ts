/**
 * Helper standards, pure part (docs/decisions.md 2026-11-22 "Helper standards"). The server wraps
 * these with the database; keeping them pure makes the rules testable on their own.
 */
import { TWO_POINT_CATEGORIES, straightKm, type ErrandDeal, type GeoPoint } from "@/lib/engine";

/**
 * Where the helper must be to start: the pickup pin if there is one; otherwise the task pin — except
 * for two-place tasks without a pickup pin (e.g. "buy it anywhere"), which start wherever the helper
 * shops, so there's nothing to check.
 */
export function startPoint(d: Pick<ErrandDeal, "category" | "pickupLocation" | "pickupAddress" | "location">): GeoPoint | null {
  if (d.pickupLocation) return d.pickupLocation;
  // a two-place task without a pickup pin (the kind's usual, or one the customer chose) has no fixed start
  if (TWO_POINT_CATEGORIES.includes(d.category) || d.pickupAddress) return null;
  return d.location;
}

export type StartCheck = { ok: true } | { ok: false; reason: "no_position" | "stale" } | { ok: false; reason: "far"; meters: number };

export interface Position { lat: number; lng: number; at: number }

/** Is the helper close enough to start? Positions older than `maxAgeSeconds` don't count. */
export function checkStart(target: GeoPoint | null, pos: Position | null, now: number, radiusM: number, maxAgeSeconds: number): StartCheck {
  if (!target) return { ok: true };
  if (!pos) return { ok: false, reason: "no_position" };
  if (now - pos.at > maxAgeSeconds * 1000 || pos.at > now + 60_000) return { ok: false, reason: "stale" };
  const meters = Math.round(straightKm(target, pos) * 1000);
  return meters <= radiusM ? { ok: true } : { ok: false, reason: "far", meters };
}

export type RecordLevel = "clear" | "warning" | "ranked_lower" | "paused" | "review";

/** Where a helper stands on the ladder with `n` active marks (thresholds are Ops settings). */
export function recordLevel(n: number, r: { marksRankLower: number; marksPause: number; marksReview: number }): RecordLevel {
  if (n >= r.marksReview) return "review";
  if (n >= r.marksPause) return "paused";
  if (n >= r.marksRankLower) return "ranked_lower";
  return n > 0 ? "warning" : "clear";
}

/** Dispatch ranking: helpers with marks at or above the "ranked lower" step lose this much score. */
export const MARK_RANK_PENALTY = 0.25;
