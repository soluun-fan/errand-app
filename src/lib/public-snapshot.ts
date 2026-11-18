import "server-only";
import { errandSplit, type CategoryId, type DealStatus } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What anyone (even logged out) may see about activity in the app: recent requests as
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

/** An open request as anyone may see it: no customer text, no place — category, trip, time, pay. */
export interface PublicOpenRequest {
  id: string;
  category: CategoryId;
  /** What the helper keeps (the posted fee; helpers keep 100%). */
  pay: number;
  people: 1 | 2;
  /** Pickup → drop-off distance, 0 for one-place tasks. */
  km: number;
  minutes: number;
  /** Scheduled start, or null for "now". */
  startsAt: number | null;
  /** not urgent (no set time): open until then */
  openUntil: number | null;
  buysItems: boolean;
  /** Only for signed-in browsing (`withTitles`); the public landing never gets the customer's words. */
  title?: string;
}

/** Open requests waiting for a helper, newest first (the landing page's board). */
export async function openRequests(
  limit = 8,
  opts: { category?: CategoryId; sort?: "new" | "pay"; minPay?: number; withTitles?: boolean; excludeCustomer?: string } = {},
): Promise<PublicOpenRequest[]> {
  let q = createAdminClient()
    .from("deals")
    .select("id, title, category, fee, commission_bps, details, scheduled_at, item_budget, mode, match_by")
    .eq("type", "errand")
    .eq("status", "open")
    .not("title", "ilike", "[verify]%")
    // a task sent to one helper first isn't on the board until it opens to everyone
    .or(`invited_helper_id.is.null,and(invite_open_after.eq.true,invite_until.lte.${new Date().toISOString()})`);
  if (opts.category) q = q.eq("category", opts.category);
  if (opts.minPay) q = q.gte("fee", opts.minPay);
  if (opts.excludeCustomer) q = q.neq("customer_id", opts.excludeCustomer); // your own posts aren't "to browse"
  const { data, error } = await q
    .order(opts.sort === "pay" ? "fee" : "created_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; title: string; category: CategoryId; fee: number; commission_bps: number; details: { people?: number; km?: number; minutes?: number } | null; scheduled_at: string | null; item_budget: number; mode: string; match_by: string | null }[]>();
  if (error) return [];
  return (data ?? []).map((r) => {
    return {
      id: r.id,
      category: r.category,
      // the engine's split, same as the job screen (CLAUDE.md: money computed by the engine only)
      pay: errandSplit({ fee: Number(r.fee), itemBudget: 0, receipt: null, serviceFee: 0, commissionBps: Number(r.commission_bps ?? 0) }).helperFeeNet,
      people: r.details?.people === 2 ? 2 : 1,
      km: Number(r.details?.km ?? 0),
      minutes: Number(r.details?.minutes ?? 30),
      startsAt: r.scheduled_at ? Date.parse(r.scheduled_at) : null,
      openUntil: !r.scheduled_at && r.mode === "schedule" && r.match_by ? Date.parse(r.match_by) : null,
      buysItems: Number(r.item_budget) > 0,
      ...(opts.withTitles ? { title: r.title } : {}),
    };
  });
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
