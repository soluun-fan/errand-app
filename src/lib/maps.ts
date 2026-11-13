/**
 * Map helpers (docs/decisions.md): our maps are MapLibre on open tiles; turn-by-turn directions
 * hand off to Google Maps via its public "Maps URLs" (no API key; opens the Google Maps app on
 * phones). Pure functions — usable on server and client.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

const pt = (p: LatLng) => `${p.lat},${p.lng}`;

/**
 * Google Maps directions from the user's current position. `via` (e.g. the store to pick up from)
 * becomes a waypoint; text works too — Google geocodes it.
 */
export function googleDirectionsUrl(destination: LatLng | string, via?: LatLng | string | null): string {
  const q = new URLSearchParams({ api: "1", destination: typeof destination === "string" ? destination : pt(destination), travelmode: "driving" });
  if (via) q.set("waypoints", typeof via === "string" ? via : pt(via));
  return `https://www.google.com/maps/dir/?${q}`;
}

/** Google Maps showing one place. */
export function googlePlaceUrl(place: LatLng | string): string {
  const q = new URLSearchParams({ api: "1", query: typeof place === "string" ? place : pt(place) });
  return `https://www.google.com/maps/search/?${q}`;
}

/** Approximate a pin to a ~300 m grid so helpers can't see a home before they're matched. */
export const FUZZ_METERS = 300;
export function fuzz(p: LatLng): LatLng {
  const step = 0.003; // ≈ 330 m north-south, ≈ 220 m east-west at UB's latitude
  const snap = (v: number) => Math.round(Math.round(v / step) * step * 1e6) / 1e6;
  return { lat: snap(p.lat), lng: snap(p.lng) };
}
