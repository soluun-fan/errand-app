"use client";

import type { StyleSpecification, LayerSpecification } from "maplibre-gl";

/**
 * Our map look (owner 2026-11-23: "like Google Maps, the UI/UX is really nice"). We keep the free,
 * key-less OpenFreeMap data and restyle its "liberty" style in the browser: calm grey land, white
 * streets with soft edges, warm main roads, light blue water, green parks, grey labels with white
 * halos, Cyrillic names only (no doubled scripts), no relief shading, 3D buildings or US shields.
 * The style is fetched once per locale and cached. If anything fails, the original style is used.
 */
export const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export const MAP_COLORS = {
  land: "#f2f3f5",
  residential: "#eceef1",
  park: "#cdebd2",
  wood: "#c3e5c8",
  water: "#a9d3f5",
  waterLabel: "#4a7fb5",
  building: "#e4e6ea",
  buildingLine: "#d6d9de",
  hospital: "#fbe5e7",
  school: "#f3ede2",
  sand: "#f3eee1",
  aeroway: "#e8eaee",
  street: "#ffffff",
  streetCasing: "#d9dce1",
  major: "#fde9a8",
  majorCasing: "#f0cf6e",
  motorway: "#fbd77b",
  motorwayCasing: "#e5b64d",
  rail: "#cfd3d9",
  path: "#e0e3e8",
  label: "#5f6368",
  placeLabel: "#3c4043",
  halo: "#ffffff",
  boundary: "#b9bec6",
} as const;

/** Layers that add noise rather than help someone find a door in Ulaanbaatar. */
const DROP = /^(natural_earth|building-3d|road_area_pattern|road_one_way_arrow.*|highway-shield-us-interstate|road_shield_us|.*_hatching|aeroway_taxiway)$/;

/**
 * One name per label. Streets and places use Mongolian (Cyrillic) first; English the other way round.
 * Place names (cities, districts, neighbourhoods): OSM often stores them in both scripts in one
 * string, so those use the Mongolian name if tagged, else the Latin one ("BAGA TOIROG") — never the
 * doubled script. Checked on screen 2026-11-24.
 */
export function labelField(locale: "mn" | "en", place = false): unknown {
  const name = locale === "en"
    ? ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]]
    : place
      ? ["coalesce", ["get", "name:mn"], ["get", "name:latin"], ["get", "name"]]
      : ["coalesce", ["get", "name:mn"], ["get", "name"], ["get", "name:latin"]];
  // some names hold two scripts on two lines: keep the first
  return ["let", "n", ["to-string", name],
    ["case", [">", ["index-of", "\n", ["var", "n"]], 0], ["slice", ["var", "n"], 0, ["index-of", "\n", ["var", "n"]]], ["var", "n"]]];
}

/** Like Google, the city's own name isn't repeated once you're down at street level. */
const CITY_LABEL_MAX_ZOOM = 13;

type Paint = Record<string, unknown>;

function paintFor(id: string): Paint | null {
  const c = MAP_COLORS;
  if (id === "background") return { "background-color": c.land };
  if (id === "park") return { "fill-color": c.park, "fill-opacity": 1 };
  if (id === "park_outline") return { "line-color": c.park, "line-opacity": 0 };
  if (id === "landuse_residential") return { "fill-color": c.residential, "fill-opacity": 0.6 };
  if (id === "landcover_wood") return { "fill-color": c.wood, "fill-opacity": 0.8 };
  if (id === "landcover_grass" || id === "landuse_pitch" || id === "landuse_cemetery") return { "fill-color": c.park, "fill-opacity": 0.7 };
  if (id === "landuse_hospital") return { "fill-color": c.hospital };
  if (id === "landuse_school") return { "fill-color": c.school };
  if (id === "landcover_sand") return { "fill-color": c.sand };
  if (id === "aeroway_fill") return { "fill-color": c.aeroway };
  if (id === "water") return { "fill-color": c.water };
  if (id.startsWith("waterway")) return { "line-color": c.water };
  if (id === "building") return { "fill-color": c.building, "fill-outline-color": c.buildingLine };
  if (id.startsWith("boundary")) return { "line-color": c.boundary };
  const road = /^(road|bridge|tunnel)_/.test(id);
  if (road && /rail/.test(id)) return { "line-color": c.rail };
  if (road && /path_pedestrian/.test(id)) return { "line-color": c.path };
  if (road && /motorway/.test(id)) return { "line-color": /casing/.test(id) ? c.motorwayCasing : c.motorway };
  if (road && /trunk_primary/.test(id)) return { "line-color": /casing/.test(id) ? c.majorCasing : c.major };
  if (road && /casing/.test(id)) return { "line-color": c.streetCasing };
  if (road) return { "line-color": c.street };
  return null;
}

function labelPaint(id: string): Paint {
  const c = MAP_COLORS;
  if (/^(water_name|waterway_line_label)/.test(id)) return { "text-color": c.waterLabel, "text-halo-color": c.halo, "text-halo-width": 1.2 };
  if (/^label_/.test(id)) return { "text-color": c.placeLabel, "text-halo-color": c.halo, "text-halo-width": 1.6 };
  if (/^poi/.test(id)) return { "text-color": c.label, "text-halo-color": c.halo, "text-halo-width": 1.4, "icon-opacity": 0.85 };
  return { "text-color": c.label, "text-halo-color": c.halo, "text-halo-width": 1.4 };
}

/** Restyle a liberty-schema style. Pure: returns a new object, never touches the input. */
export function googlify(base: StyleSpecification, locale: "mn" | "en"): StyleSpecification {
  const style = structuredClone(base) as StyleSpecification;
  const layers: LayerSpecification[] = [];
  for (const layer of style.layers) {
    if (DROP.test(layer.id)) continue;
    // edited loosely as JSON; the result is checked against the style spec in the tests
    const l = layer as unknown as { id: string; type: string; paint?: Paint; layout?: Paint };
    // shapes get our colours; labels (symbols) get label colours below
    const paint = l.type === "symbol" ? null : paintFor(l.id);
    if (paint) l.paint = { ...(l.paint ?? {}), ...paint };
    if (l.type === "symbol") {
      const tf = l.layout?.["text-field"];
      // names only; road numbers (shields) keep their own text
      if (tf && JSON.stringify(tf).includes("name")) l.layout = { ...l.layout, "text-field": labelField(locale, /^label_/.test(l.id)) };
      if (/^label_(city|city_capital|town)$/.test(l.id)) (l as { maxzoom?: number }).maxzoom = CITY_LABEL_MAX_ZOOM;
      l.paint = { ...(l.paint ?? {}), ...labelPaint(l.id) };
    }
    layers.push(l as unknown as LayerSpecification);
  }
  style.layers = layers;
  if (style.sources.ne2_shaded) delete style.sources.ne2_shaded;
  return style;
}

const cache = new Map<string, Promise<StyleSpecification | string>>();

/** The restyled map for this locale; falls back to the original style URL if it can't be built. */
export function mapStyle(locale: "mn" | "en"): Promise<StyleSpecification | string> {
  let p = cache.get(locale);
  if (!p) {
    p = fetch(BASE_STYLE_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`style ${r.status}`))))
      .then((s: StyleSpecification) => googlify(s, locale))
      .catch(() => BASE_STYLE_URL);
    cache.set(locale, p);
  }
  return p;
}
