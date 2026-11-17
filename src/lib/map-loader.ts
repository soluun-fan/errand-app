"use client";

/**
 * Loads MapLibre once and tells it where its worker file is (copied to /vendor on install by
 * scripts/copy-map-worker.mjs) — bundlers don't serve the file MapLibre 6 looks for by default.
 */
let loading: Promise<typeof import("maplibre-gl")> | null = null;

export function loadMapLibre(): Promise<typeof import("maplibre-gl")> {
  loading ??= import("maplibre-gl").then((ml) => {
    ml.setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${ml.getVersion()}`);
    return ml;
  });
  return loading;
}
