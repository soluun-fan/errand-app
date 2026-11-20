"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { freshPosition, type JobLocation } from "@/lib/location-rules";
import { googleDirectionsUrl, googlePlaceUrl, type LatLng } from "@/lib/maps";
import { distanceKm } from "@/lib/dispatch/plan";
import { MapHero } from "./detail";
import { TaskMap, type MapMarker } from "./task-map";

/** Expire stale coordinates on the client even when page refreshes fail or the connection drops. */
export function CustomerTaskMap({ destination, pickup, address, pickupAddress, helperName, tracking, serverNow }: {
  destination: LatLng | null;
  pickup: LatLng | null;
  address: string;
  pickupAddress: string | null;
  helperName: string;
  tracking?: JobLocation | null;
  serverNow: number;
}) {
  const t = useT();
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 5_000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  const helper = freshPosition(tracking?.position ?? null, now);
  const markers: MapMarker[] = [
    ...(pickup ? [{ ...pickup, kind: "pickup" as const, label: pickupAddress ?? t("map.pickup") }] : []),
    ...(destination ? [{ ...destination, kind: "task" as const, label: address }] : []),
    ...(helper ? [{ ...helper, kind: "helper" as const, label: helperName }] : []),
  ];
  const status = !tracking?.available ? "trackingUnavailable" : !tracking.sharing ? "trackingOff" :
    helper ? "trackingLive" : tracking.position ? "trackingStale" : "trackingWaiting";
  const caption = helper && destination
    ? t("map.helperHere", { name: helperName, km: distanceKm(helper, destination).toFixed(1) })
    : tracking ? t(`map.${status}`) : undefined;
  return <MapHero backHref="/" backLabel={t("common.back")} caption={caption ? <span role="status">{caption}</span> : undefined}>
    <TaskMap
      rounded={false}
      className="h-[44vh] min-h-64"
      markers={markers}
      route={[...(helper ? [helper] : []), ...(pickup ? [pickup] : []), ...(destination ? [destination] : [])]}
      openUrl={destination
        ? helper || pickup ? googleDirectionsUrl(destination, helper ? pickup : null, helper ?? pickup) : googlePlaceUrl(destination)
        : pickup ? googlePlaceUrl(pickup) : undefined}
    />
  </MapHero>;
}
