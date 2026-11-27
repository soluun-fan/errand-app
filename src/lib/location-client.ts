import { LOCATION_INTERVAL_MS } from "./location-rules";

export type LocationStatus = "locating" | "live" | "denied" | "unavailable";

/**
 * getCurrentPosition, but when high accuracy can't be had ("Position update is unavailable" — common
 * on computers and indoors — or too slow), ask once more with normal accuracy (Wi-Fi / cell). A
 * refused permission is never retried. Same call shape as the browser's own (2026-11-27).
 */
export function getCurrentPositionWithFallback(
  success: PositionCallback,
  error: PositionErrorCallback,
  options: PositionOptions = {},
): void {
  if (!navigator.geolocation) {
    error({ code: 2, message: "Geolocation unavailable", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    success,
    (e) => {
      if (e.code === 1 /* PERMISSION_DENIED */ || options.enableHighAccuracy === false) return error(e);
      navigator.geolocation.getCurrentPosition(success, error, {
        enableHighAccuracy: false,
        maximumAge: Math.max(options.maximumAge ?? 0, 30_000),
        timeout: Math.max(options.timeout ?? 0, 20_000),
      });
    },
    options,
  );
}

export function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation unavailable"));
    getCurrentPositionWithFallback((p) => {
      const age = Date.now() - p.timestamp;
      if (!Number.isFinite(age) || age < -5_000 || age > 30_000 ||
        !Number.isFinite(p.coords.latitude) || Math.abs(p.coords.latitude) > 90 ||
        !Number.isFinite(p.coords.longitude) || Math.abs(p.coords.longitude) > 180) {
        reject(new Error("Invalid or stale position"));
      } else resolve(p);
    }, reject, {
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
