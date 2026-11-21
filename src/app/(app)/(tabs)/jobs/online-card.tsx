"use client";

import { useState, useTransition } from "react";
import { MapPin } from "lucide-react";
import { PushToggle } from "@/components/push-toggle";
import { chipClass } from "@/components/ui";
import { useT } from "@/i18n/client";
import { setPresence } from "../../jobs/actions";
import { useWorkerLocation } from "@/components/worker-location";
import { currentPosition } from "@/lib/location-client";

const RADII: { km: number; label: "km" | "district" | "city" }[] = [
  { km: 1, label: "km" },
  { km: 3, label: "km" },
  { km: 5, label: "km" },
  { km: 10, label: "km" },
  { km: 15, label: "district" },
  { km: 60, label: "city" },
];

type Geo = "idle" | "on" | "denied" | "unsupported";

/**
 * UBCab-style availability (docs/rules.md §Dispatch): online toggle, radius, and the position
 * heartbeat that dispatch ranks by. Position is only read while online.
 */
export function OnlineCard({ online, radiusKm }: { online: boolean; radiusKm: number }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [geo, setGeo] = useState<Geo>("idle");
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const location = useWorkerLocation();

  const save = (patch: { online?: boolean; radius?: number; lat?: number; lng?: number }) => {
    const f = new FormData();
    f.set("online", (patch.online ?? online) ? "on" : "");
    f.set("radius", String(patch.radius ?? radiusKm));
    if (patch.lat !== undefined && patch.lng !== undefined) {
      f.set("lat", String(patch.lat));
      f.set("lng", String(patch.lng));
    }
    start(async () => {
      try {
        const result = await setPresence(f);
        if (result.error) { setError(result.error); return; }
        setError(null);
        await location?.reload();
        setFailed(false);
      } catch { setFailed(true); }
    });
  };

  const goOnline = async () => {
    if (locating || pending) return;
    if (!("geolocation" in navigator)) {
      setGeo("unsupported");
      return;
    }
    setLocating(true);
    try {
      const p = await currentPosition();
      setGeo("on");
      save({ online: true, lat: p.coords.latitude, lng: p.coords.longitude });
    } catch (error) {
      setGeo((error as { code?: number })?.code === 1 ? "denied" : "idle");
      setFailed(true);
    } finally { setLocating(false); }
  };

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
          disabled={pending || locating}
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
              disabled={pending || locating}
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
          <MapPin size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{t("job.location")}</span>
          <span className="block text-sm text-ink-2">
            {geo === "denied" || location?.status === "denied" ? t("job.locationDenied")
              : online && location?.status === "live" ? t("job.locationOn") : t("job.locationOff")}
          </span>
        </span>
      </div>
      {failed && <p role="status" className="text-sm text-danger">{t("job.locationError")}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <PushToggle />
    </section>
  );
}
