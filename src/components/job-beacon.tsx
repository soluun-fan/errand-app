"use client";

import { useEffect, useState } from "react";
import { setJobLocationSharing, trackJob } from "@/app/(app)/jobs/actions";
import { useT } from "@/i18n/client";
import { btn } from "./ui";

export function JobBeacon({ dealId, initiallySharing }: { dealId: string; initiallySharing: boolean }) {
  const t = useT();
  const [sharing, setSharing] = useState(initiallySharing);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!sharing) return;
    let active = true;
    let pending = false;
    function sample() {
      if (!active || pending || document.visibilityState !== "visible") return;
      if (!navigator.geolocation) { setFailed(true); return; }
      pending = true;
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          if (active) await trackJob(dealId, position.coords.latitude, position.coords.longitude);
          if (active) setFailed(false);
        } catch {
          if (active) setFailed(true);
        } finally { pending = false; }
      }, () => { pending = false; if (active) setFailed(true); }, { maximumAge: 15_000, timeout: 15_000 });
    }
    sample();
    const interval = window.setInterval(sample, 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [sharing, dealId]);

  async function toggle() {
    setBusy(true);
    try {
      if (!(await setJobLocationSharing(dealId, !sharing))) throw new Error("Job ended");
      setSharing(!sharing);
      setFailed(false);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  return <section className="rounded-card bg-bg p-4 shadow-card">
    <button type="button" className={btn.text} disabled={busy} aria-pressed={sharing} onClick={toggle}>
      {t(sharing ? "job.locationStop" : "job.locationShare")}
    </button>
    <p className="text-sm text-ink-2">{t("job.locationHint")}</p>
    {failed && <p role="status">{t("job.locationError")}</p>}
  </section>;
}
