"use client";

import { LocateFixed, Loader2 } from "lucide-react";

/**
 * Google-Maps-like map pieces (2026-11-23): teardrop pins, the blue "you are here" dot, price chips
 * and the round locate button. Markers are plain DOM elements because MapLibre places DOM markers.
 */
const PIN_COLORS = { red: "#ea4335", dark: "#3c4043", green: "#0a7a60" } as const;
export type PinColor = keyof typeof PIN_COLORS;

/** SVG teardrop pin (30×40), tip at the bottom centre — use MapLibre `anchor: "bottom"`. */
export function pinSvg(color: PinColor, size = 30): string {
  const h = Math.round(size * 4 / 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}" viewBox="0 0 30 40" aria-hidden="true">
    <path d="M15 1C7.3 1 1 7.1 1 14.7 1 25 15 39 15 39s14-14 14-24.3C29 7.1 22.7 1 15 1z" fill="${PIN_COLORS[color]}" stroke="#fff" stroke-width="2"/>
    <circle cx="15" cy="14.5" r="5" fill="#fff"/>
  </svg>`;
}

export function pinElement(color: PinColor, label?: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = pinSvg(color);
  el.style.filter = "drop-shadow(0 2px 2px rgb(0 0 0 / 0.25))";
  if (label) el.title = label;
  return el;
}

export function meElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "map-me";
  return el;
}

/** A white pill with dark bold text (prices on the jobs map). */
export function chipElement(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "rounded-full bg-white px-2.5 py-1 text-meta font-bold text-ink shadow-[0_1px_4px_rgb(0_0_0/0.3)]";
  el.textContent = text;
  return el;
}

/** The helper on the way: a green circle with a person, like a moving vehicle marker. */
export function helperElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white bg-held text-white shadow-[0_2px_6px_rgb(0_0_0/0.3)]";
  el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/></svg>`;
  return el;
}

/** Round white "my location" button, bottom-right over the map. */
export function LocateButton({ onClick, busy, label, className = "" }: { onClick: () => void; busy: boolean; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className={`press absolute z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-map-control shadow-[0_2px_6px_rgb(0_0_0/0.25)] disabled:text-ink-3 ${className}`}
    >
      {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <LocateFixed size={20} aria-hidden />}
    </button>
  );
}

/**
 * Map credits (OpenStreetMap, OpenMapTiles, OpenFreeMap) show when the map opens, then fold into
 * the small ⓘ after 5 seconds or the first drag — what OSM's attribution guidelines allow, and how
 * phone maps keep the corner clear.
 */
export function foldAttributionLater(map: { once: (type: "movestart", fn: () => void) => unknown; getContainer: () => HTMLElement }): () => void {
  const fold = () => map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  const timer = window.setTimeout(fold, 5000);
  map.once("movestart", fold);
  return () => window.clearTimeout(timer);
}
