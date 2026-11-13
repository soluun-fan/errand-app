"use client";

import { useEffect, useRef } from "react";
import { trackJob } from "@/app/(app)/jobs/actions";

const EVERY_MS = 30_000;

/** While a helper is on a job, shares their position with that task's customer (every ~30 s). */
export function JobBeacon({ dealId }: { dealId: string }) {
  const last = useRef(0);
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - last.current < EVERY_MS) return;
        last.current = Date.now();
        void trackJob(dealId, p.coords.latitude, p.coords.longitude);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [dealId]);
  return null;
}
