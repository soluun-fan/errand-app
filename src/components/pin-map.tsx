"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { loadMapLibre } from "@/lib/map-loader";
import type { Map as MlMap, Marker } from "maplibre-gl";
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

export type PinKind = "drop" | "pickup";

/** Centre pin and fixed-marker looks: pickup ● (dark), drop-off / task place ↘ (red). */
const PIN_GLYPH: Record<PinKind, string> = { drop: "📍", pickup: "⚫" };
const MARKER_CLASS: Record<PinKind, string> = {
  drop: "h-8 w-8 rounded-full border-[3px] border-white bg-danger text-white shadow-float",
  pickup: "h-8 w-8 rounded-full border-[3px] border-white bg-ink text-white shadow-float",
};
const MARKER_GLYPH: Record<PinKind, string> = { drop: "↘", pickup: "●" };

/**
 * Ride-app style pin picker: the pin stays in the middle, the map moves under it. Reports the
 * pin after each move. Ulaanbaatar addresses are landmark-based, so a pin beats text search.
 * `other` shows the task's other point (e.g. the drop-off while placing the pickup) as a fixed marker.
 */
export function PinMap({
  value,
  onChange,
  height = 220,
  kind = "drop",
  other = null,
  start = null,
}: {
  value: Pin | null;
  onChange: (p: Pin) => void;
  height?: number;
  /** Which point the centre pin is placing. */
  kind?: PinKind;
  other?: (Pin & { kind: PinKind }) | null;
  /** Where to open the map while `value` is still empty (e.g. near the other pin). */
  start?: Pin | null;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const otherMarker = useRef<Marker | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMapLibre()
      .then(({ Map }) => {
        if (cancelled || !box.current) return;
        const from = value ?? start ?? UB_CENTER;
        const m = new Map({
          container: box.current,
          style: MAP_STYLE,
          center: [from.lng, from.lat],
          zoom: value || start ? 15 : 12,
          attributionControl: { compact: true },
        });
        m.on("moveend", () => {
          const c = m.getCenter();
          changed.current({ lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 });
        });
        m.on("error", () => setFailed(true));
        m.on("load", () => setReady(true));
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
  }, [value, ready]);

  // the other point, as a fixed marker
  const otherKey = other ? `${other.kind}:${other.lat},${other.lng}` : "";
  useEffect(() => {
    const m = map.current;
    otherMarker.current?.remove();
    otherMarker.current = null;
    if (!m || !ready || !other) return;
    let cancelled = false;
    loadMapLibre().then(({ Marker }) => {
      if (cancelled) return;
      const el = document.createElement("div");
      el.className = `flex items-center justify-center ${MARKER_CLASS[other.kind]}`;
      el.textContent = MARKER_GLYPH[other.kind];
      otherMarker.current = new Marker({ element: el }).setLngLat([other.lng, other.lat]).addTo(m);
    });
    return () => {
      cancelled = true;
    };
    // `otherKey` captures `other`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherKey, ready]);

  const locate = () => {
    setLocationError(false);
    if (!("geolocation" in navigator)) { setLocationError(true); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        changed.current({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 });
        map.current?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 16 });
      },
      () => { setLocating(false); setLocationError(true); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  if (failed) return <p className="rounded-card bg-fill p-4 text-sm text-ink-2">{t("map.failed")}</p>;
  return (
    <div>
    <div className="relative overflow-hidden rounded-card border border-line" style={{ height }}>
      <div ref={box} className="absolute inset-0 h-full w-full" aria-label={t("map.pinLabel")} role="application" />
      {/* the fixed centre pin */}
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full text-4xl drop-shadow">
        {PIN_GLYPH[kind]}
      </span>
      <button
        type="button"
        disabled={locating}
        onClick={locate}
        className="absolute bottom-10 right-3 z-10 flex min-h-11 items-center gap-1.5 rounded-full bg-bg px-4 text-sm font-semibold shadow-float"
      >
        {locating ? "…" : "◎"} {t("map.myLocation")}
      </button>
      {!value && (
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-bg/95 px-3 py-1.5 text-sm font-medium shadow-float">{t(kind === "pickup" ? "map.moveHintPickup" : "map.moveHint")}</span>
      )}
    </div>
    {locationError && <p role="status" className="mt-2 text-sm text-ink-2">{t("addressEntry.locationFailed")}</p>}
    </div>
  );
}
