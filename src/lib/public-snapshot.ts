import "server-only";
import type { CategoryId, DealStatus } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What anyone (even logged out) may see about activity on Tuslamj: recent requests as
 * category + price + status + time, and how many helpers are online. Never titles, descriptions,
 * places or people — those are the customer's own words and stay private (docs/decisions.md
 * 2026-11-16 "Landing page"). Real numbers only; nothing is invented.
 */
export interface PublicRequest {
  category: CategoryId;
  fee: number;
  status: DealStatus;
  createdAt: number;
}

const SHOWN: DealStatus[] = ["open", "awaiting_payment", "matched", "in_progress", "check", "released"];

export async function recentRequests(limit = 5): Promise<PublicRequest[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data, error } = await createAdminClient()
    .from("deals")
    .select("category, fee, status, created_at")
    .eq("type", "errand")
    .in("status", SHOWN)
    .gte("created_at", since)
    // the pilot's own test tasks are titled "[verify] …"; keep them out of public view
    .not("title", "ilike", "[verify]%")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<{ category: CategoryId; fee: number; status: DealStatus; created_at: string }[]>();
  if (error) return [];
  return (data ?? []).map((r) => ({ category: r.category, fee: Number(r.fee), status: r.status, createdAt: Date.parse(r.created_at) }));
}

/** Approved helpers online right now (position seen in the last 10 minutes). */
export async function onlineHelperCount(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("helper_presence")
    .select("user_id", { count: "exact", head: true })
    .eq("online", true)
    .gt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());
  return error ? 0 : (count ?? 0);
}
