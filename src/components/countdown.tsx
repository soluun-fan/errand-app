"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fmtCountdown } from "@/lib/format";

/**
 * Live countdown on server time: `serverNow` is the server's clock when the page rendered,
 * so a wrong phone clock can't make it lie. At zero it refreshes the page; the server then
 * settles the deal (auto-release, expiry). `pill` = the amber warn pill (DESIGN §4.16).
 */
export function Countdown({ until, serverNow, template, pill = false }: { until: number; serverNow: number; template?: string; pill?: boolean }) {
  const router = useRouter();
  const skew = useRef<number | null>(null);
  const [left, setLeft] = useState(until - serverNow);
  const refreshed = useRef(false);

  useEffect(() => {
    skew.current ??= serverNow - Date.now();
    const tick = () => {
      const ms = until - (Date.now() + (skew.current ?? 0));
      setLeft(ms);
      if (ms <= 0 && !refreshed.current) {
        refreshed.current = true;
        router.refresh();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until, serverNow, router]);

  const clock = fmtCountdown(left);
  const text = template ? template.replace("{time}", clock) : clock;
  return (
    <span
      className={`tabular-nums ${pill ? "inline-flex items-center gap-1.5 rounded-full bg-warn-bg px-3 py-1.5 text-sm font-semibold text-warn" : ""}`}
      role="timer"
      aria-live="off"
    >
      {pill && <span aria-hidden>⏱</span>}
      {text}
    </span>
  );
}
