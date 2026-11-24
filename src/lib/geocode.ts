/**
 * Place search for the pin picker (2026-11-24, key-free): Photon by komoot, an OpenStreetMap-based
 * search service. Only the text the person types is sent — never their position or the task's pin
 * (results are biased toward central Ulaanbaatar with a fixed point). Limited to Mongolia.
 */
export const PHOTON_URL = "https://photon.komoot.io/api/";
/** Mongolia's bounding box (west, south, east, north). */
export const MONGOLIA_BBOX = [87.7, 41.5, 119.95, 52.2] as const;
const UB = { lat: 47.9186, lng: 106.9177 };

export interface PlaceResult {
  id: string;
  /** What the place is called (a shop, a building, a street). */
  name: string;
  /** Where it is: street, district, city — whatever is known. */
  detail: string;
  lat: number;
  lng: number;
}

interface PhotonFeature {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
}

/** OSM names often carry the traditional script too, and some say "Улан-Батор" (Russian): tidy both. */
const RENAME: Record<string, string> = { "Улан-Батор": "Улаанбаатар" };
export function tidy(s: unknown): string {
  const t = String(s ?? "").replace(/[\u1800-\u18AF\u202F]+/g, " ").replace(/\s+/g, " ").trim();
  return RENAME[t] ?? t;
}

/** Turns Photon's answer into short, deduplicated results. Pure, so it is unit-tested. */
export function parsePhoton(body: unknown): PlaceResult[] {
  const features = (body as { features?: PhotonFeature[] })?.features ?? [];
  const out: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const [lng, lat] = c;
    if (lng < MONGOLIA_BBOX[0] || lng > MONGOLIA_BBOX[2] || lat < MONGOLIA_BBOX[1] || lat > MONGOLIA_BBOX[3]) continue;
    const street = tidy([p.street, p.housenumber].filter(Boolean).join(" "));
    const name = tidy(p.name) || street;
    if (!name) continue;
    const detail = [p.name ? street : "", p.district, p.locality, p.city ?? p.county, p.state]
      .map(tidy)
      .filter((x, i, all) => x && x !== name && all.indexOf(x) === i)
      .slice(0, 3)
      .join(", ");
    const key = `${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `${p.osm_type ?? "x"}${p.osm_id ?? out.length}`, name, detail, lat, lng });
  }
  return out;
}

/** Search places by text (3+ characters). Throws on network errors so the UI can say so. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 100);
  if (q.length < 3) return [];
  const url = new URL(PHOTON_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lat", String(UB.lat));
  url.searchParams.set("lon", String(UB.lng));
  url.searchParams.set("bbox", MONGOLIA_BBOX.join(","));
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  return parsePhoton(await res.json()).slice(0, 6);
}
