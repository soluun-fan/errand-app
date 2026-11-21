"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { loadMapLibre } from "@/lib/map-loader";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { MAP_STYLE, UB_CENTER } from "./pin-map";

export type MarkerKind = "task" | "pickup" | "helper" | "me" | "job" | "area" | "pickupArea";

export interface MapMarker {
  lat: number;
  lng: number;
  kind: MarkerKind;
  /** Short text on/near the marker (e.g. "5,400₮"). */
  label?: string;
  /** Tapping the marker opens this page. */
  href?: string;
}

const STYLE: Record<MarkerKind, string> = {
  task: "h-9 w-9 rounded-full border-[3px] border-white bg-danger text-white shadow-float",
  pickup: "h-9 w-9 rounded-full border-[3px] border-white bg-ink text-white shadow-float",
  helper: "h-10 w-10 rounded-full border-[3px] border-white bg-held text-white shadow-float",
  me: "h-5 w-5 rounded-full border-[3px] border-white bg-[#1a73e8] shadow-float",
  job: "min-h-8 rounded-full border-2 border-white bg-ink px-2.5 text-[13px] font-bold text-white shadow-float",
  // approximate place (before a helper is matched): a soft circle, no exact point
  area: "h-24 w-24 rounded-full border-2 border-danger/60 bg-danger/15",
  pickupArea: "h-24 w-24 rounded-full border-2 border-ink/50 bg-ink/10",
};
const GLYPH: Partial<Record<MarkerKind, string>> = { task: "↘", pickup: "●", helper: "🧍" };

/** Points of a route line, drawn in order (e.g. helper → pickup → drop-off). */
export interface RoutePoint {
  lat: number;
  lng: number;
}

/** A straight dashed line through the points: shows the trip at a glance (not turn-by-turn). */
function routeData(points: RoutePoint[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: points.length >= 2 ? points.map((p) => [p.lng, p.lat]) : [] },
  };
}

/**
 * Read-only map with markers (MapLibre on open tiles). Fits all markers in view; tapping a marker
 * with `href` navigates. Used on Home, the customer's task, the helper's job and the job feed.
 * `route` draws a line through its points; with `routeFromMe` it starts at the viewer's position.
 */
export function TaskMap({
  markers,
  className = "h-56",
  showMe = false,
  rounded = true,
  route = [],
  routeFromMe = false,
  openUrl,
}: {
  markers: MapMarker[];
  className?: string;
  /** Also show the viewer's own position (asks the browser once). */
  showMe?: boolean;
  rounded?: boolean;
  route?: RoutePoint[];
  /** Start the route at the viewer's position (needs `showMe`). */
  routeFromMe?: boolean;
  /** A tap on the map (not a drag, not a marker link) opens this — e.g. Google Maps directions. */
  openUrl?: string;
}) {
  const t = useT();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const placed = useRef<Marker[]>([]);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const openUrlRef = useRef(openUrl);
  openUrlRef.current = openUrl;
  const key = JSON.stringify(markers) + JSON.stringify(me) + JSON.stringify(route) + String(routeFromMe);

  useEffect(() => {
    let cancelled = false;
    loadMapLibre()
      .then(({ Map }) => {
        if (cancelled || !box.current) return;
        const m = new Map({
          container: box.current,
          style: MAP_STYLE,
          center: [UB_CENTER.lng, UB_CENTER.lat],
          zoom: 12,
          attributionControl: { compact: true },
        });
        m.on("error", () => setFailed(true));
        // one tap opens the navigation app; dragging and pinching still move the map
        m.on("click", () => {
          if (openUrlRef.current) window.open(openUrlRef.current, "_blank", "noopener,noreferrer");
        });
        m.on("load", () => { setReady(true); setFailed(false); });
        map.current = m;
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!showMe || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setMe({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { maximumAge: 60_000, timeout: 10_000 },
    );
  }, [showMe]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let cancelled = false;
    loadMapLibre().then(({ Marker, LngLatBounds }) => {
      if (cancelled) return;
      for (const p of placed.current) p.remove();
      placed.current = [];
      const all: MapMarker[] = [...markers, ...(me ? [{ ...me, kind: "me" as const }] : [])];
      // the route line sits under the markers
      const line = routeData([...(routeFromMe && me ? [me] : []), ...route]);
      const src = m.getSource("route") as GeoJSONSource | undefined;
      if (src) src.setData(line);
      else {
        // docs/ui.md: routes use the route token (blue)
        const color = getComputedStyle(document.documentElement).getPropertyValue("--color-route").trim() || "#2f6fed";
        m.addSource("route", { type: "geojson", data: line });
        m.addLayer({
          id: "route",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": color, "line-width": 4, "line-opacity": 0.75, "line-dasharray": [1, 1.6] },
        });
      }
      for (const mk of all) {
        const el = document.createElement(mk.href ? "button" : "div");
        el.className = `flex items-center justify-center ${STYLE[mk.kind]}`;
        el.textContent = mk.kind === "job" ? (mk.label ?? "") : (GLYPH[mk.kind] ?? "");
        if (mk.label && mk.kind !== "job") el.title = mk.label;
        if (mk.href) {
          el.setAttribute("aria-label", mk.label ?? t("map.open"));
          el.addEventListener("click", (e) => {
            e.stopPropagation(); // a marker link wins over "open in Google Maps"
            router.push(mk.href as string);
          });
        }
        placed.current.push(new Marker({ element: el }).setLngLat([mk.lng, mk.lat]).addTo(m));
      }
      if (all.length === 1) m.jumpTo({ center: [all[0].lng, all[0].lat], zoom: all[0].kind === "area" || all[0].kind === "pickupArea" ? 14 : 15 });
      else if (all.length > 1) {
        const b = new LngLatBounds();
        for (const mk of all) b.extend([mk.lng, mk.lat]);
        m.fitBounds(b, { padding: 56, maxZoom: 15, duration: 0 });
      }
    });
    return () => {
      cancelled = true;
    };
    // `key` captures markers + me; router/t are stable enough for this read-only map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  return (
    <div className={`relative overflow-hidden ${rounded ? "rounded-card border border-line" : ""} ${className}`}>
      <div ref={box} className={`absolute inset-0 h-full w-full ${openUrl ? "cursor-pointer" : ""}`} role="region" aria-label={t("map.label")} />
      {failed && <div role="status" className="pointer-events-none absolute inset-x-0 bottom-0 bg-fill p-4 text-center text-sm text-ink-2">{t("map.failed")}</div>}
      {openUrl && (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="press absolute right-3 top-3 z-10 flex min-h-10 items-center gap-1 rounded-full bg-bg/95 px-3 text-[13px] font-semibold text-ink shadow-card"
        >
          {t("map.openGoogle")} ↗
        </a>
      )}
    </div>
  );
}
