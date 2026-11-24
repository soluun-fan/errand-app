"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { loadMapLibre } from "@/lib/map-loader";
import type { Map as MlMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { BASE_STYLE_URL, mapStyle } from "@/lib/map-style";
import { LocateButton, foldAttributionLater, meElement, pinElement, pinSvg } from "./map-ui";
import { PlaceSearch } from "./place-search";

/** Open-source map (MapLibre) on free OpenStreetMap-based tiles — no API key (docs/decisions.md). Restyled in lib/map-style.ts. */
export const MAP_STYLE = BASE_STYLE_URL;
/** Sükhbaatar Square. */
export const UB_CENTER = { lat: 47.9186, lng: 106.9177 };

export interface Pin {
  lat: number;
  lng: number;
}

export type PinKind = "drop" | "pickup";

/** Pickup is a dark pin, drop-off / the task's place a red one (Google-Maps-like, 2026-11-23). */
const PIN_COLOR = { drop: "red", pickup: "dark" } as const;

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
  const locale = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const meMarker = useRef<Marker | null>(null);
  const [lifted, setLifted] = useState(false);
  const [drops, setDrops] = useState(0);
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
    let unfold: (() => void) | null = null;
    Promise.all([loadMapLibre(), mapStyle(locale)])
      .then(([{ Map }, style]) => {
        if (cancelled || !box.current) return;
        const from = value ?? start ?? UB_CENTER;
        const m = new Map({
          container: box.current,
          style,
          center: [from.lng, from.lat],
          zoom: value || start ? 15 : 12,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        m.touchZoomRotate.disableRotation();
        // the pin lifts while the map moves and drops when it stops
        m.on("movestart", () => setLifted(true));
        m.on("moveend", () => {
          setLifted(false);
          setDrops((n) => n + 1);
          const c = m.getCenter();
          changed.current({ lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 });
        });
        m.on("error", () => setFailed(true));
        m.on("load", () => { setReady(true); unfold = foldAttributionLater(m); });
        map.current = m;
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      unfold?.();
      meMarker.current?.remove();
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
      otherMarker.current = new Marker({ element: pinElement(PIN_COLOR[other.kind]), anchor: "bottom" }).setLngLat([other.lng, other.lat]).addTo(m);
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
        const m = map.current;
        m?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 16 });
        // the blue "you are here" dot stays where the phone was
        if (m) void loadMapLibre().then(({ Marker }) => {
          meMarker.current?.remove();
          meMarker.current = new Marker({ element: meElement() }).setLngLat([p.coords.longitude, p.coords.latitude]).addTo(m);
        });
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
      {/* the fixed centre pin: its tip marks the spot; a small shadow shows where it will land */}
      <span aria-hidden data-lifted={lifted} className="map-pin-shadow pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/30" />
      <span
        aria-hidden
        key={drops}
        data-lifted={lifted}
        data-dropped={!lifted && drops > 0}
        className="map-pin pointer-events-none absolute left-1/2 top-1/2 -ml-[17px] -mt-[45px] drop-shadow-[0_2px_2px_rgb(0_0_0/0.25)]"
        dangerouslySetInnerHTML={{ __html: pinSvg(PIN_COLOR[kind], 34) }}
      />
      <LocateButton label={t("map.myLocation")} busy={locating} onClick={locate} className="bottom-10 right-3" />
      <PlaceSearch
        onPick={(p) => {
          changed.current({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });
          map.current?.flyTo({ center: [p.lng, p.lat], zoom: 17 });
        }}
      />
      {!value && (
        <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-bg/95 px-3 py-1.5 text-sm font-medium shadow-float">{t(kind === "pickup" ? "map.moveHintPickup" : "map.moveHint")}</span>
      )}
    </div>
    {locationError && <p role="status" className="mt-2 text-sm text-ink-2">{t("addressEntry.locationFailed")}</p>}
    </div>
  );
}
