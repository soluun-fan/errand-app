export const LOCATION_INTERVAL_MS = 15_000;
export const LOCATION_FRESH_MS = 90_000;

export interface SharedPosition {
  lat: number;
  lng: number;
  updatedAt: number;
}

export interface JobLocation {
  available: boolean;
  sharing: boolean;
  position: SharedPosition | null;
}

export interface WorkerLocationState {
  available: boolean;
  online: boolean;
  jobIds: string[];
}

export function freshPosition(position: SharedPosition | null, now: number): SharedPosition | null {
  if (!position || !Number.isFinite(position.lat) || Math.abs(position.lat) > 90 ||
    !Number.isFinite(position.lng) || Math.abs(position.lng) > 180 || !Number.isFinite(position.updatedAt)) return null;
  const age = now - position.updatedAt;
  return age >= -5_000 && age < LOCATION_FRESH_MS ? position : null;
}

/** A missing optional table must not take the whole task page down during a rolling deployment. */
export function missingTable(error: { code?: string; message?: string } | null, table: string): boolean {
  return Boolean(error && ["42P01", "PGRST205"].includes(error.code ?? "") && error.message?.includes(table));
}
