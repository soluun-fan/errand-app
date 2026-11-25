"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { loadMapLibre } from "@/lib/map-loader";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { mapStyle } from "@/lib/map-style";
import { LocateButton, chipElement, foldAttributionLater, helperElement, meElement, pinElement } from "./map-ui";
import { UB_CENTER } from "./pin-map";

export type MarkerKind = "task" | "pickup" | "helper" | "me" | "job" | "area" | "pickupArea" | "busy";

export interface MapMarker {
  lat: number;
  lng: number;
  kind: MarkerKind;
  /** Short text on/near the marker (e.g. "5,400₮"). */
  label?: string;
  /** Tapping the marker opens this page. */
  href?: string;
}

/** Approximate places (before a helper is matched): a soft circle, no exact point. */
const AREA: Partial<Record<MarkerKind, string>> = {
  area: "h-24 w-24 rounded-full border-2 border-[#ea4335]/60 bg-[#ea4335]/15",
  pickupArea: "h-24 w-24 rounded-full border-2 border-ink/50 bg-ink/10",
};

/** Google-Maps-like marker for each kind (2026-11-23) and where it is anchored. */
function markerFor(mk: MapMarker): { el: HTMLElement; anchor: "bottom" | "center" } {
  if (mk.kind === "task") return { el: pinElement("red", mk.label), anchor: "bottom" };
  if (mk.kind === "pickup") return { el: pinElement("dark", mk.label), anchor: "bottom" };
  if (mk.kind === "helper") return { el: helperElement(), anchor: "center" };
  if (mk.kind === "me") return { el: meElement(), anchor: "center" };
  if (mk.kind === "job") return { el: chipElement(mk.label ?? ""), anchor: "center" };
  if (mk.kind === "busy") {
    // where tasks are waiting (a ~1 km square, not a place): bigger for more tasks
    const n = Number(mk.label ?? 1);
    const size = Math.min(72, 34 + n * 6);
    const el = document.createElement("div");
    el.className =
      "flex items-center justify-center rounded-full border-2 border-[#f29900]/70 bg-[#f29900]/25 text-[13px] font-bold text-[#b06000]";
    el.style.width = el.style.height = `${size}px`;
    el.textContent = String(n);
    return { el, anchor: "center" };
  }
  const el = document.createElement("div");
  el.className = AREA[mk.kind] ?? "";
  return { el, anchor: "center" };
}

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
  const locale = useLocale();
  const router = useRouter();
  const [locating, setLocating] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const placed = useRef<Marker[]>([]);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const openUrlRef = useRef(openUrl);
  useEffect(() => {
    openUrlRef.current = openUrl;
  }, [openUrl]);
  const key = JSON.stringify(markers) + JSON.stringify(me) + JSON.stringify(route) + String(routeFromMe);

  useEffect(() => {
    let cancelled = false;
    let unfold: (() => void) | null = null;
    let resize: ResizeObserver | null = null;
    Promise.all([loadMapLibre(), mapStyle(locale)])
      .then(([{ Map }, style]) => {
        if (cancelled || !box.current) return;
        const m = new Map({
          container: box.current,
          style,
          center: [UB_CENTER.lng, UB_CENTER.lat],
          zoom: 12,
          attributionControl: { compact: true },
          // flat and north-up, like a phone map in normal use
          dragRotate: false,
          pitchWithRotate: false,
        });
        m.touchZoomRotate.disableRotation();
        m.on("error", () => setFailed(true));
        // one tap opens the navigation app; dragging and pinching still move the map
        m.on("click", () => {
          if (openUrlRef.current) window.open(openUrlRef.current, "_blank", "noopener,noreferrer");
        });
        m.on("load", () => {
          setReady(true);
          setFailed(false);
          unfold = foldAttributionLater(m);
        });
        map.current = m;
        // the box can change size after the map starts (fonts, sidebars, a wider screen): keep the canvas filling it
        resize = new ResizeObserver(() => m.resize());
        resize.observe(box.current);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      resize?.disconnect();
      unfold?.();
      map.current?.remove();
      map.current = null;
    };
    // the map is created once per page (the locale doesn't change while it's open)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // a solid blue route with a white edge (docs/ui.md: routes use the route token)
        const color = getComputedStyle(document.documentElement).getPropertyValue("--color-route").trim() || "#1a73e8";
        m.addSource("route", { type: "geojson", data: line });
        m.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 8 },
        });
        m.addLayer({
          id: "route",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": color, "line-width": 5 },
        });
      }
      for (const mk of all) {
        const { el, anchor } = markerFor(mk);
        if (mk.href) {
          el.setAttribute("role", "button");
          el.tabIndex = 0;
          el.style.cursor = "pointer";
          el.setAttribute("aria-label", mk.label ?? t("map.open"));
          const go = (e: Event) => {
            e.stopPropagation(); // a marker link wins over "open in Google Maps"
            router.push(mk.href as string);
          };
          el.addEventListener("click", go);
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") go(e);
          });
        }
        placed.current.push(new Marker({ element: el, anchor }).setLngLat([mk.lng, mk.lat]).addTo(m));
      }
      // busy areas are background: frame the helper's own jobs (and position) when there are any
      const own = all.filter((mk) => mk.kind !== "busy");
      const frame = own.length > 0 ? own : all;
      if (frame.length === 1)
        m.jumpTo({
          center: [frame[0].lng, frame[0].lat],
          zoom: frame[0].kind === "area" || frame[0].kind === "pickupArea" ? 14 : frame[0].kind === "busy" ? 13 : 15,
        });
      else if (frame.length > 1) {
        const b = new LngLatBounds();
        for (const mk of frame) b.extend([mk.lng, mk.lat]);
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
      <div
        ref={box}
        className={`absolute inset-0 h-full w-full ${openUrl ? "cursor-pointer" : ""}`}
        role="region"
        aria-label={t("map.label")}
      />
      {failed && (
        <div role="status" className="pointer-events-none absolute inset-x-0 bottom-0 bg-fill p-4 text-center text-sm text-ink-2">
          {t("map.failed")}
        </div>
      )}
      {showMe && ready && (
        <LocateButton
          label={t("map.myLocation")}
          busy={locating}
          className="bottom-8 right-3"
          onClick={() => {
            if (!("geolocation" in navigator)) return;
            setLocating(true);
            navigator.geolocation.getCurrentPosition(
              (p) => {
                setLocating(false);
                const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
                setMe(pos);
                map.current?.flyTo({ center: [pos.lng, pos.lat], zoom: Math.max(map.current.getZoom(), 15) });
              },
              () => setLocating(false),
              { enableHighAccuracy: true, timeout: 10_000 },
            );
          }}
        />
      )}
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
