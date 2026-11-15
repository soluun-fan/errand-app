/**
 * Distance for pricing (docs/decisions.md 2026-11-16 "Maps connected"). Key-free and offline:
 * the straight line between the two pins times a road factor — city streets are rarely straight.
 * Always available (no third-party router to go down); the customer's −20%…+30% price freedom
 * absorbs the approximation. A real router can replace `roadKm` later without UI changes.
 */
export interface LatLngLike {
  lat: number;
  lng: number;
}

/** Typical detour of UB streets over the straight line. */
export const ROAD_FACTOR = 1.3;

/** Great-circle distance in km (haversine). */
export function straightKm(a: LatLngLike, b: LatLngLike): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Estimated road distance between two pins, rounded to 0.1 km. */
export function roadKm(a: LatLngLike, b: LatLngLike): number {
  return Math.round(straightKm(a, b) * ROAD_FACTOR * 10) / 10;
}
