import "server-only";
import type { PlatformRules } from "@/lib/rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Backing out late (docs/decisions.md 2026-11-17 "Backing out"): the database records each late
 * back-out and pauses the helper by the Ops rules (platform_rules: 1st / 2nd / 3rd-or-more in 30 days,
 * care at once; apply_transition v9). This module only reads, to warn the helper beforehand and alert Ops.
 */
export const OPS_ALERT_AT = 3;
const WINDOW_MS = 30 * 86_400_000;

/** Same rule as apply_transition v9, from the same settings. */
export function pauseDaysFor(nth: number, care: boolean, r: Pick<PlatformRules, "pauseDaysFirst" | "pauseDaysSecond" | "pauseDaysMore" | "carePauseDays">): number {
  if (care) return r.carePauseDays;
  return nth <= 1 ? r.pauseDaysFirst : nth === 2 ? r.pauseDaysSecond : r.pauseDaysMore;
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
