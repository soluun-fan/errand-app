/**
 * "Busy areas" for helpers (2026-11-24): where open tasks are waiting across the city, counted per
 * coarse square (0.01° ≈ 1.1 km × 0.75 km in Ulaanbaatar) — coarser than the ~300 m blur helpers
 * already see, so no home can be picked out. Pure, so it is unit-tested.
 */
export const BUSY_STEP = 0.01;

export interface BusyCell { lat: number; lng: number; count: number }

export function busyCells(points: { lat: number | null; lng: number | null }[], max = 30): BusyCell[] {
  const cells = new Map<string, BusyCell>();
  for (const p of points) {
    if (p.lat == null || p.lng == null || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const i = Math.floor(p.lat / BUSY_STEP);
    const j = Math.floor(p.lng / BUSY_STEP);
    const key = `${i}:${j}`;
    const c = cells.get(key) ?? { lat: Math.round((i + 0.5) * BUSY_STEP * 1e5) / 1e5, lng: Math.round((j + 0.5) * BUSY_STEP * 1e5) / 1e5, count: 0 };
    c.count++;
    cells.set(key, c);
  }
  return [...cells.values()].sort((a, b) => b.count - a.count).slice(0, max);
}
