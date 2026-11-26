"use client";

import Link from "next/link";
import { ChevronRight, MapPinOff } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getWorkerLocationState, setJobLocationSharing, updateWorkerLocation } from "@/app/(app)/jobs/actions";
import { startLocationUpdates, type LocationStatus } from "@/lib/location-client";
import type { WorkerLocationState } from "@/lib/location-rules";
import { useT } from "@/i18n/client";

const Context = createContext<{
  state: WorkerLocationState | null;
  status: LocationStatus;
  reload: () => Promise<void>;
  retry: () => Promise<void>;
  setSharing: (dealId: string, sharing: boolean) => Promise<void>;
  /** online or on a job: location is being sent */
  tracking: boolean;
} | null>(null);

export const useWorkerLocation = () => useContext(Context);

/** Lives in the signed-in layout, so opening chat or another task keeps sharing active. */
export function WorkerLocationProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
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
    try {
      await reload();
      setAttempt((n) => n + 1);
    } catch {
      setStatus("unavailable");
    }
  }, [reload]);
  const setSharing = useCallback(async (dealId: string, sharing: boolean) => {
    if (!(await setJobLocationSharing(dealId, sharing))) throw new Error("Job ended");
    // Apply acknowledged consent immediately; a failed follow-up read must not leave a
    // successful opt-in looking stopped, or a successful opt-out looking active.
    ++revision.current;
    setState(
      (previous) =>
        previous && {
          ...previous,
          jobIds: sharing ? [...new Set([...previous.jobIds, dealId])].sort() : previous.jobIds.filter((id) => id !== dealId),
        },
    );
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
      // This is a request generation counter: invalidate every in-flight response on cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return startLocationUpdates(
      async (lat, lng) => {
        const version = revision.current;
        const next = await updateWorkerLocation(lat, lng);
        if (version === revision.current) setState(next);
      },
      setStatus,
      jobKey ? 15_000 : 60_000,
    );
  }, [tracking, jobKey, attempt]);

  return <Context.Provider value={{ state, status, reload, retry, setSharing, tracking }}>{children}</Context.Provider>;
}

/** The slim location strip; placed by the layout right under the top bar (2026-11-24). */
export function WorkerLocationStrip() {
  const t = useT();
  const ctx = useContext(Context);
  if (!ctx) return null;
  const { state, status, retry, tracking } = ctx;
  const failed = status === "denied" || status === "unavailable";
  return tracking && (state?.jobIds.length || failed) ? (
    <div className="mx-auto w-full max-w-2xl px-5 pt-2">
      {/* one slim strip: amber when location is failing (with Retry), green while it is shared */}
      <div
        role="status"
        className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-input px-3 py-2 text-small sm:grid-cols-[auto_minmax(0,1fr)_auto] ${failed ? "bg-warn-bg text-warn" : "bg-held-bg text-held"}`}
      >
        {failed ? (
          <MapPinOff aria-hidden size={18} className="shrink-0" />
        ) : (
          <span aria-hidden className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-held opacity-60 motion-reduce:animate-none" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-held" />
          </span>
        )}
        <p className="min-w-0 flex-1 font-medium">
          {t(failed ? "job.locationError" : status === "live" ? "job.locationActive" : "job.locationLocating")}
        </p>
        {failed ? (
          <button
            type="button"
            className="col-start-2 min-h-10 justify-self-start rounded-full bg-bg px-3 font-semibold text-ink shadow-card sm:col-start-auto"
            onClick={() => void retry()}
          >
            {t("common.retry")}
          </button>
        ) : (
          state?.jobIds.slice(0, 1).map((id) => (
            <Link
              key={id}
              href={`/jobs/${id}`}
              aria-label={t("job.locationManage")}
              className="col-start-2 inline-flex min-h-10 items-center gap-0.5 justify-self-start font-semibold underline-offset-4 hover:underline sm:col-start-auto"
            >
              {t("job.locationOpen")}
              <ChevronRight aria-hidden size={16} />
            </Link>
          ))
        )}
      </div>
    </div>
  ) : null;
}
