"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { PushToggle } from "@/components/push-toggle";
import { chipClass } from "@/components/ui";
import { useT } from "@/i18n/client";
import { heartbeat, setPresence } from "../../jobs/actions";

const RADII: { km: number; label: "km" | "district" | "city" }[] = [
  { km: 1, label: "km" },
  { km: 3, label: "km" },
  { km: 5, label: "km" },
  { km: 10, label: "km" },
  { km: 15, label: "district" },
  { km: 60, label: "city" },
];
const HEARTBEAT_MS = 60_000;

type Geo = "idle" | "on" | "denied" | "unsupported";

/**
 * UBCab-style availability (docs/rules.md §Dispatch): online toggle, radius, and the position
 * heartbeat that dispatch ranks by. Position is only read while online.
 */
export function OnlineCard({ online, radiusKm }: { online: boolean; radiusKm: number }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [geo, setGeo] = useState<Geo>("idle");
  const last = useRef(0);

  const save = (patch: { online?: boolean; radius?: number; lat?: number; lng?: number }) => {
    const f = new FormData();
    f.set("online", (patch.online ?? online) ? "on" : "");
    f.set("radius", String(patch.radius ?? radiusKm));
    if (patch.lat !== undefined && patch.lng !== undefined) {
      f.set("lat", String(patch.lat));
      f.set("lng", String(patch.lng));
    }
    start(() => setPresence(f));
  };

  const goOnline = () => {
    if (!("geolocation" in navigator)) {
      setGeo("unsupported");
      return save({ online: true });
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeo("on");
        last.current = Date.now();
        save({ online: true, lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        setGeo("denied");
        save({ online: true });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  // While online: follow the position, send at most one heartbeat a minute.
  useEffect(() => {
    if (!online || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGeo("on");
        if (Date.now() - last.current < HEARTBEAT_MS) return;
        last.current = Date.now();
        void heartbeat(p.coords.latitude, p.coords.longitude);
      },
      (e) => setGeo(e.code === e.PERMISSION_DENIED ? "denied" : "idle"),
      { enableHighAccuracy: true, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [online]);

  return (
    <section className={`flex flex-col gap-4 rounded-card border p-4 ${online ? "border-held bg-held-bg" : "border-line"}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={`h-3 w-3 flex-none rounded-full ${online ? "bg-held" : "bg-ink-3"}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold">{online ? t("job.online") : t("job.offline")}</span>
          <span className="block text-sm text-ink-2">{online ? t("job.onlineSub") : t("job.offlineSub")}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={online}
          aria-label={online ? t("job.offline") : t("job.online")}
          disabled={pending}
          onClick={() => (online ? save({ online: false }) : goOnline())}
          className={`relative h-9 w-16 flex-none rounded-full transition-colors disabled:opacity-60 ${online ? "bg-held" : "bg-ink-3"}`}
        >
          <span className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow transition-all ${online ? "left-8" : "left-1"}`} />
        </button>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("job.radius")}</legend>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup">
          {RADII.map((r) => (
            <button
              key={r.km}
              type="button"
              role="radio"
              aria-checked={radiusKm === r.km}
              disabled={pending}
              onClick={() => save({ radius: r.km })}
              className={chipClass(radiusKm === r.km)}
            >
              {r.label === "km" ? t("job.km", { n: r.km }) : t(`job.${r.label}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-11 w-11 flex-none items-center justify-center rounded-input bg-fill text-xl">
          📍
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{t("job.location")}</span>
          <span className="block text-sm text-ink-2">
            {geo === "denied" ? t("job.locationDenied") : online && geo === "on" ? t("job.locationOn") : t("job.locationOff")}
          </span>
        </span>
      </div>
      <PushToggle />
    </section>
  );
}
