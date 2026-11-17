import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Backing out late (docs/decisions.md 2026-11-17 "Backing out"): the database records each late
 * back-out and pauses the helper — 1st in 30 days 1 day, 2nd 3 days, 3rd or more 7 days; care work
 * 7 days at once (apply_transition v8). This module only reads, to warn the helper beforehand and alert Ops.
 */
export const OPS_ALERT_AT = 3;
const WINDOW_MS = 30 * 86_400_000;

/** Same rule as apply_transition v8: care work 7 days at once; otherwise 1, 3, then 7. */
export function pauseDaysFor(nth: number, care = false): number {
  if (care) return 7;
  return nth <= 1 ? 1 : nth === 2 ? 3 : 7;
}

/** Late back-outs by this helper in the last 30 days. */
export async function recentBackOuts(helperId: string, now = Date.now()): Promise<number> {
  const { count } = await createAdminClient()
    .from("helper_penalties")
    .select("id", { count: "exact", head: true })
    .eq("helper_id", helperId)
    .gt("created_at", new Date(now - WINDOW_MS).toISOString());
  return count ?? 0;
}
