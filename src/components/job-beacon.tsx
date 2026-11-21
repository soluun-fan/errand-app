"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { currentPosition } from "@/lib/location-client";
import { useWorkerLocation } from "./worker-location";
import { btn } from "./ui";

export function JobBeacon({ dealId }: { dealId: string }) {
  const t = useT();
  const location = useWorkerLocation();
  const sharing = location?.state?.jobIds.includes(dealId) ?? false;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      if (!sharing) await currentPosition(); // Ask permission on the worker's tap, before saving consent.
      if (!location) throw new Error("Location unavailable");
      await location.setSharing(dealId, !sharing);
      setFailed(false);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  return <section className="rounded-card bg-bg p-4 shadow-card">
    <button type="button" className={btn.text} disabled={busy || !location?.state?.available} aria-pressed={sharing} onClick={toggle}>
      {t(sharing ? "job.locationStop" : "job.locationShare")}
    </button>
    <p className="text-sm text-ink-2">{t("job.locationHint")}</p>
    {(location?.state?.available === false || (!location?.state && location?.status === "unavailable")) && <p role="status">{t("job.locationUnavailable")}</p>}
    {(failed || (sharing && ["denied", "unavailable"].includes(location?.status ?? ""))) && <p role="status">{t("job.locationError")}</p>}
    {location && (location.state?.available === false || location.status === "unavailable" || location.status === "denied") &&
      <button type="button" className={btn.text} disabled={busy} onClick={() => void location.retry()}>{t("common.retry")}</button>}
  </section>;
}
