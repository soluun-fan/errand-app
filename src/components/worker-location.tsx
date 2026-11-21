"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getWorkerLocationState, setJobLocationSharing, updateWorkerLocation } from "@/app/(app)/jobs/actions";
import { startLocationUpdates, type LocationStatus } from "@/lib/location-client";
import type { WorkerLocationState } from "@/lib/location-rules";
import { useT } from "@/i18n/client";
import { btn } from "./ui";

const Context = createContext<{
  state: WorkerLocationState | null;
  status: LocationStatus;
  reload: () => Promise<void>;
  retry: () => Promise<void>;
  setSharing: (dealId: string, sharing: boolean) => Promise<void>;
} | null>(null);

export const useWorkerLocation = () => useContext(Context);

/** Lives in the signed-in layout, so opening chat or another task keeps sharing active. */
export function WorkerLocationProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const [state, setState] = useState<WorkerLocationState | null>(null);
  const [status, setStatus] = useState<LocationStatus>("locating");
  const [attempt, setAttempt] = useState(0);
  const revision = useRef(0);
  const reload = useCallback(async () => {
    const version = ++revision.current;
    const next = await getWorkerLocationState();
    if (version === revision.current) setState(next);
  }, []);
  const retry = useCallback(async () => {
    setStatus("locating");
    try { await reload(); setAttempt(n => n + 1); }
    catch { setStatus("unavailable"); }
  }, [reload]);
  const setSharing = useCallback(async (dealId: string, sharing: boolean) => {
    if (!(await setJobLocationSharing(dealId, sharing))) throw new Error("Job ended");
    // Apply acknowledged consent immediately; a failed follow-up read must not leave a
    // successful opt-in looking stopped, or a successful opt-out looking active.
    ++revision.current;
    setState(previous => previous && ({ ...previous, jobIds: sharing
      ? [...new Set([...previous.jobIds, dealId])].sort()
      : previous.jobIds.filter(id => id !== dealId) }));
    if (sharing) setStatus("locating");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void reload().catch(() => setStatus("unavailable"));
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      ++revision.current;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [enabled, pathname, reload]);

  const tracking = enabled && Boolean(state?.online || state?.jobIds.length);
  const jobKey = state?.jobIds.slice().sort().join(",") ?? "";
  useEffect(() => {
    if (!tracking) return;
    return startLocationUpdates(async (lat, lng) => {
      const version = revision.current;
      const next = await updateWorkerLocation(lat, lng);
      if (version === revision.current) setState(next);
    }, setStatus, jobKey ? 15_000 : 60_000);
  }, [tracking, jobKey, attempt]);

  const failed = status === "denied" || status === "unavailable";
  return <Context.Provider value={{ state, status, reload, retry, setSharing }}>
    {tracking && (state?.jobIds.length || failed) ? <div className="mx-auto w-full max-w-2xl px-5 py-2">
      <div role="status" className="rounded-input bg-held-bg p-3 text-sm">
        <p>{t(failed ? "job.locationError" : status === "live" ? "job.locationActive" : "job.locationLocating")}</p>
        {failed && <button type="button" className={btn.text} onClick={() => void retry()}>{t("common.retry")}</button>}
        {state?.jobIds.map(id => <Link key={id} href={`/jobs/${id}`} className="inline-flex min-h-11 items-center font-semibold underline">
          {t("job.locationManage")}
        </Link>)}
      </div>
    </div> : null}
    {children}
  </Context.Provider>;
}
