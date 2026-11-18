"use client";

import { useEffect } from "react";
import { reportClientError } from "@/app/report-error";

/** Sends uncaught browser errors to the Ops error log (at most 5 per page visit, each once). */
export function ErrorReporter() {
  useEffect(() => {
    const seen = new Set<string>();
    const send = (message: string, stack?: string) => {
      // noise from browser extensions and aborted loads isn't ours
      if (!message || seen.size >= 5 || seen.has(message) || /ResizeObserver loop|chrome-extension:|moz-extension:|Load failed|NetworkError|Failed to fetch/i.test(`${message} ${stack ?? ""}`)) return;
      seen.add(message);
      void reportClientError(message, stack ?? null, location.pathname).catch(() => undefined);
    };
    const onError = (e: ErrorEvent) => send(e.message, e.error instanceof Error ? e.error.stack : undefined);
    const onRejection = (e: PromiseRejectionEvent) => send(e.reason instanceof Error ? e.reason.message : String(e.reason), e.reason instanceof Error ? e.reason.stack : undefined);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
