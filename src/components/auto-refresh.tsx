"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the server page every `seconds` while the tab is visible, optionally running a
 * server action first (e.g. advance dispatch). Stand-in until Supabase Realtime pushes changes.
 */
export function AutoRefresh({ seconds, poke }: { seconds: number; poke?: () => Promise<void> }) {
  const router = useRouter();
  useEffect(() => {
    let busy = false;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      try {
        if (poke) await poke();
        router.refresh();
      } finally {
        busy = false;
      }
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [seconds, poke, router]);
  return null;
}
