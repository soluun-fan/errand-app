"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { currentPosition } from "@/lib/location-client";
import { useWorkerLocation } from "./worker-location";
import { btn } from "./ui";

/**
 * Helper standards (2026-11-22): during a job the helper's location is shared with the customer —
 * required, switched on when the job starts and off when it ends. No "stop" button; if the phone
 * isn't sending (permission lost), say so and offer to try again.
 */
export function JobBeacon({ dealId }: { dealId: string }) {
  const t = useT();
  const location = useWorkerLocation();
  const sharing = location?.state?.jobIds.includes(dealId) ?? false;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const broken = failed || ["denied", "unavailable"].includes(location?.status ?? "") || location?.state?.available === false;

  async function turnOn() {
    setBusy(true);
    try {
      await currentPosition(); // ask permission on the helper's tap
      if (!location) throw new Error("Location unavailable");
      if (!sharing) await location.setSharing(dealId, true);
      await location.retry();
      setFailed(false);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  return <section className="rounded-card bg-bg p-4 shadow-card">
    <p className="font-semibold">{t("standards.trackingRequired")}</p>
    <p className="text-small text-ink-2">{t("standards.trackingHint")}</p>
    {broken && <p role="status" className="mt-2 text-small font-semibold text-danger">{t("job.locationError")}</p>}
    {(broken || !sharing) && location &&
      <button type="button" className={btn.text} disabled={busy} onClick={() => void turnOn()}>{t("standards.trackingRetry")}</button>}
  </section>;
}
