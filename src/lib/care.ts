import "server-only";
import { CATEGORIES } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Care pilot (docs/decisions.md 2026-11-17 "Care pilot"): meet first, first-aid badge.
 * Server-only reads; callers check who may see what.
 */
export const CARE_KINDS = CATEGORIES.filter((c) => c.trust === "care").map((c) => c.id);

/** Helpers this family already had a finished care job with — the "meet first" rule doesn't apply to them. */
export async function workedTogether(customerId: string, helperIds: readonly string[]): Promise<Set<string>> {
  if (!helperIds.length) return new Set();
  const { data } = await createAdminClient()
    .from("deals")
    .select("helper_id")
    .eq("customer_id", customerId)
    .in("helper_id", [...helperIds])
    .in("category", CARE_KINDS)
    .eq("status", "released")
    .returns<{ helper_id: string }[]>();
  return new Set((data ?? []).map((r) => r.helper_id));
}

/** Helpers with an Ops-approved first-aid certificate (claimed on a care clearance, checked by Ops). */
export async function firstAidHelpers(helperIds: readonly string[]): Promise<Set<string>> {
  if (!helperIds.length) return new Set();
  const { data } = await createAdminClient()
    .from("helper_certificates")
    .select("helper_id")
    .in("helper_id", [...helperIds])
    .eq("first_aid", true)
    .eq("status", "approved")
    .returns<{ helper_id: string }[]>();
  return new Set((data ?? []).map((r) => r.helper_id));
}
