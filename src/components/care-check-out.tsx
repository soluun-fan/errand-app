"use client";

import { useState } from "react";
import { careCheckOut } from "@/app/(app)/jobs/actions";
import { useT } from "@/i18n/client";
import { btn } from "./ui";

/** Care work: "I'm leaving" — records the time and position (no photo), then the job can be finished. */
export function CareCheckOut({ dealId, done }: { dealId: string; done: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const pos = await new Promise<GeolocationPosition | null>((ok) =>
      "geolocation" in navigator ? navigator.geolocation.getCurrentPosition(ok, () => ok(null), { timeout: 4000, maximumAge: 60_000 }) : ok(null),
    );
    const r = await careCheckOut(dealId, pos?.coords.latitude ?? null, pos?.coords.longitude ?? null);
    if (r.error) setError(r.error);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-card bg-bg shadow-card p-4">
      <div>
        <p className="font-semibold">
          {t("care.checkOutTitle")} {done && <span className="text-held">· {t("proof.done")}</span>}
        </p>
        <p className="text-small text-ink-2">{t("care.checkOutSub")}</p>
      </div>
      {!done && (
        <button type="button" disabled={busy} onClick={go} className={`${btn.primary} w-full`}>
          {busy ? t("proof.uploading") : t("care.checkOut")}
        </button>
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
