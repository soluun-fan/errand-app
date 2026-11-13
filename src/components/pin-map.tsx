"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";

/** Open-source map (MapLibre) on free OpenStreetMap-based tiles — no API key (docs/decisions.md). */
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
/** Sükhbaatar Square. */
export const UB_CENTER = { lat: 47.9186, lng: 106.9177 };

export interface Pin {
  lat: number;
  lng: number;
}

/**
 * Ride-app style pin picker: the pin stays in the middle, the map moves under it. Reports the
 * pin after each move. Ulaanbaatar addresses are landmark-based, so a pin beats text search.
 */
export function PinMap({ value, onChange, height = 220 }: { value: Pin | null; onChange: (p: Pin) => void; height?: number }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl")
      .then(({ Map }) => {
        if (cancelled || !box.current) return;
        const start = value ?? UB_CENTER;
        const m = new Map({
          container: box.current,
          style: MAP_STYLE,
          center: [start.lng, start.lat],
          zoom: value ? 16 : 12,
          attributionControl: { compact: true },
        });
        m.on("moveend", () => {
          const c = m.getCenter();
          changed.current({ lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 });
        });
        m.on("error", () => setFailed(true));
        map.current = m;
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // the map is created once; later `value` changes move it via flyTo below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !value) return;
    const c = m.getCenter();
    if (Math.abs(c.lat - value.lat) > 1e-5 || Math.abs(c.lng - value.lng) > 1e-5) m.jumpTo({ center: [value.lng, value.lat], zoom: Math.max(m.getZoom(), 15) });
  }, [value]);

  const locate = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        map.current?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 16 });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  if (failed) return <p className="rounded-card bg-fill p-4 text-sm text-ink-2">{t("map.failed")}</p>;
  return (
    <div className="relative overflow-hidden rounded-card border border-line" style={{ height }}>
      <div ref={box} className="absolute inset-0" aria-label={t("map.pinLabel")} role="application" />
      {/* the fixed centre pin */}
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full text-4xl drop-shadow">
        📍
      </span>
      <button
        type="button"
        onClick={locate}
        className="absolute bottom-3 right-3 flex min-h-11 items-center gap-1.5 rounded-full bg-bg px-4 text-sm font-semibold shadow-float"
      >
        {locating ? "…" : "◎"} {t("map.myLocation")}
      </button>
      {!value && (
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-bg/95 px-3 py-1.5 text-sm font-medium shadow-float">{t("map.moveHint")}</span>
      )}
    </div>
  );
}
