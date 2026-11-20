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
    let active = true;
    const update = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      try {
        if (poke) await poke();
      } catch {
        // Dispatch can fail temporarily; still refresh the page and retry on the next interval.
      } finally {
        if (active) router.refresh();
        busy = false;
      }
    };
    const id = setInterval(update, seconds * 1000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
    };
  }, [seconds, poke, router]);
  return null;
}
