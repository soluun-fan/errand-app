import { LOCATION_INTERVAL_MS } from "./location-rules";

export type LocationStatus = "locating" | "live" | "denied" | "unavailable";

export function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation unavailable"));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, maximumAge: 10_000, timeout: 12_000,
    });
  });
}

/** Periodic samples keep stationary helpers fresh too. Never send a queued sample after cleanup. */
export function startLocationUpdates(
  send: (lat: number, lng: number) => Promise<void>,
  status: (value: LocationStatus) => void,
  intervalMs = LOCATION_INTERVAL_MS,
): () => void {
  let active = true;
  let pending = false;
  async function sample() {
    if (!active || pending || document.visibilityState !== "visible") return;
    pending = true;
    try {
      const p = await currentPosition();
      if (!active || document.visibilityState !== "visible") return;
      const age = Date.now() - p.timestamp;
      if (!Number.isFinite(age) || age < -5_000 || age > 30_000) throw new Error("Stale position");
      await send(p.coords.latitude, p.coords.longitude);
      if (active) status("live");
    } catch (error) {
      if (active) status((error as { code?: number })?.code === 1 ? "denied" : "unavailable");
    } finally { pending = false; }
  }
  status("locating");
  void sample();
  const timer = setInterval(() => void sample(), intervalMs);
  document.addEventListener("visibilitychange", sample);
  window.addEventListener("online", sample);
  return () => {
    active = false;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", sample);
    window.removeEventListener("online", sample);
  };
}
