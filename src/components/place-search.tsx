"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { searchPlaces, type PlaceResult } from "@/lib/geocode";

/**
 * "Search here" over the pin picker (2026-11-24, Google-Maps-like). Typing 3+ characters lists
 * places from OpenStreetMap; picking one moves the map there, and the person still fine-tunes the
 * pin by moving the map. Only the typed text leaves the phone (lib/geocode.ts).
 */
export function PlaceSearch({ onPick }: { onPick: (p: PlaceResult) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 3) { setResults(null); setState("idle"); return; }
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      setState("busy");
      searchPlaces(text, ctl.signal)
        .then((r) => { setResults(r); setState("idle"); })
        .catch((e) => { if ((e as Error).name !== "AbortError") setState("failed"); });
    }, 350);
    return () => { window.clearTimeout(timer); ctl.abort(); };
  }, [q]);

  // close the list when tapping elsewhere
  useEffect(() => {
    const close = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const showList = open && q.trim().length >= 3;
  return (
    <div ref={box} className="absolute inset-x-3 top-3 z-20">
      <label className="flex h-11 items-center gap-2 rounded-full bg-white px-4 shadow-[0_2px_6px_rgb(0_0_0/0.2)]">
        <Search size={18} aria-hidden className="flex-none text-[#5f6368]" />
        <input
          id="place-search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
          placeholder={t("map.search")}
          aria-label={t("map.search")}
          autoComplete="off"
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[#202124] outline-none placeholder:text-[#80868b]"
        />
        {q && (
          <button type="button" aria-label={t("map.searchClear")} onClick={() => { setQ(""); setResults(null); }} className="flex h-8 w-8 flex-none items-center justify-center text-[#5f6368]">
            <X size={16} aria-hidden />
          </button>
        )}
      </label>
      {showList && (
        <ul role="listbox" aria-label={t("map.search")} className="mt-1.5 max-h-56 overflow-y-auto rounded-2xl bg-white py-1 shadow-[0_4px_12px_rgb(0_0_0/0.2)]">
          {state === "busy" && !results && <li className="px-4 py-3 text-sm text-[#5f6368]">…</li>}
          {state === "failed" && <li className="px-4 py-3 text-sm text-[#5f6368]">{t("map.searchFailed")}</li>}
          {state !== "failed" && results?.length === 0 && <li className="px-4 py-3 text-sm text-[#5f6368]">{t("map.searchNone")}</li>}
          {results?.map((r) => (
            <li key={r.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-[#f1f3f4] focus-visible:bg-[#f1f3f4]"
                onClick={() => { onPick(r); setQ(r.name); setOpen(false); }}
              >
                <span className="text-[15px] font-medium text-[#202124]">{r.name}</span>
                {r.detail && <span className="text-[13px] text-[#5f6368]">{r.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
