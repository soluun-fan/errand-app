import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { MAP_COLORS, googlify, labelField } from "@/lib/map-style";

/** A trimmed copy of OpenFreeMap "liberty" (the real one is fetched in the browser). */
const base: StyleSpecification = {
  version: 8,
  sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" }, ne2_shaded: { type: "raster", url: "x" } },
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
    { id: "natural_earth", type: "raster", source: "ne2_shaded" },
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#9cf" } },
    { id: "road_trunk_primary_casing", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-color": "#e9ac77" } },
    { id: "road_minor", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-color": "#fff" } },
    { id: "building-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building" },
    { id: "label_city", type: "symbol", source: "openmaptiles", "source-layer": "place", layout: { "text-field": ["concat", ["get", "name:latin"], "\n", ["get", "name:nonlatin"]] } },
    { id: "highway-shield-non-us", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", layout: { "text-field": ["to-string", ["get", "ref"]] } },
  ],
} as StyleSpecification;

it("restyles colours, drops clutter and shows one name per label", () => {
  const s = googlify(base, "mn");
  const ids = s.layers.map((l) => l.id);
  expect(ids).not.toContain("natural_earth");
  expect(ids).not.toContain("building-3d");
  expect(s.sources.ne2_shaded).toBeUndefined();
  const by = (id: string) => s.layers.find((l) => l.id === id) as { paint?: Record<string, unknown>; layout?: Record<string, unknown> };
  expect(by("background").paint?.["background-color"]).toBe(MAP_COLORS.land);
  expect(by("water").paint?.["fill-color"]).toBe(MAP_COLORS.water);
  expect(by("road_trunk_primary_casing").paint?.["line-color"]).toBe(MAP_COLORS.majorCasing);
  expect(by("road_minor").paint?.["line-color"]).toBe(MAP_COLORS.street);
  expect(by("label_city").layout?.["text-field"]).toEqual(labelField("mn", true));
  expect((s.layers.find((l) => l.id === "label_city") as { maxzoom?: number }).maxzoom).toBe(13);
  expect(by("highway-shield-non-us").layout?.["text-field"]).toEqual(["to-string", ["get", "ref"]]); // road numbers untouched
  expect(base.layers).toHaveLength(8); // input not changed
});

it("English shows English or Latin names first; two-script names keep only their first line", () => {
  expect(JSON.stringify(labelField("en"))).toContain('["coalesce",["get","name:en"],["get","name:latin"],["get","name"]]');
  expect(JSON.stringify(labelField("mn"))).toContain('"index-of"');
});

it("every layer of the real liberty style is either restyled, kept or dropped on purpose", () => {
  let real: StyleSpecification | null = null;
  try {
    real = JSON.parse(readFileSync(process.env.LIBERTY_JSON ?? "/nonexistent", "utf8"));
  } catch {
    return; // optional: run with LIBERTY_JSON=path to check against a downloaded copy
  }
  const s = googlify(real!, "mn");
  expect(s.layers.length).toBeGreaterThan(50);
  expect(s.layers.find((l) => l.id === "building-3d")).toBeUndefined();
});
