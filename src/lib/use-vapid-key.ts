"use client";

import { useEffect, useState } from "react";

let pending: Promise<string | null> | null = null;

/**
 * The Web Push public key for this browser: the one built into the page, or — if the build didn't
 * have it — asked from the server once (/api/push-key). `undefined` while asking.
 */
export function useVapidKey(): string | null | undefined {
  const built = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
  const [key, setKey] = useState<string | null | undefined>(built ?? undefined);
  useEffect(() => {
    if (built) return;
    pending ??= fetch("/api/push-key", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { key: null }))
      .then((j: { key?: unknown }) => (typeof j.key === "string" && j.key ? j.key : null))
      .catch(() => null);
    let live = true;
    void pending.then((k) => {
      if (live) setKey(k);
    });
    return () => {
      live = false;
    };
  }, [built]);
  return key;
}
