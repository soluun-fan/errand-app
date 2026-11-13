import "server-only";
import type { Viewer } from "@/lib/auth";
import { loadDeal, runCommand } from "@/lib/db/deals";
import { dealFromRow, type DealRow } from "@/lib/db/mapping";
import { dueCommand, type Deal, type ErrandDeal } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";

const SYSTEM = { kind: "system" } as const;

/**
 * Applies anything that is already due (auto-release, no-helper expiry) before showing a
 * deal, so screens never show a stale "held" state. The background job (CLAUDE.md §10 step 8)
 * will do the same on a schedule; both are safe to run because the engine rejects repeats.
 */
async function settle(deal: Deal): Promise<Deal> {
  const cmd = dueCommand(deal, Date.now());
  if (!cmd) return deal;
  try {
    return (await runCommand(createAdminClient(), deal.id, cmd, SYSTEM)).deal;
  } catch {
    // Someone else (another request or the job) settled it first; just reload.
    return (await loadDeal(createAdminClient(), deal.id)) ?? deal;
  }
}

export function canView(deal: Deal, viewer: Viewer): boolean {
  const id = viewer.profile.id;
  if (viewer.profile.role === "admin") return true;
  if (deal.type === "goods") return deal.sellerId === id || deal.buyerId === id;
  return deal.customerId === id || deal.helperId === id || deal.offers.some((o) => o.helperId === id);
}

/** The deal if this viewer may see it, settled; otherwise null (render 404). */
export async function getDealForViewer(id: string, viewer: Viewer): Promise<Deal | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const deal = await loadDeal(createAdminClient(), id);
  if (!deal || !canView(deal, viewer)) return null;
  return settle(deal);
}

export interface TaskListItem {
  deal: ErrandDeal;
  offerCount: number;
}

/** The viewer's own errands, newest first. */
export async function listMyTasks(viewerId: string, opts: { activeOnly?: boolean } = {}): Promise<TaskListItem[]> {
  const db = createAdminClient();
  let q = db
    .from("deals")
    .select("*, offers(count)")
    .eq("type", "errand")
    .eq("customer_id", viewerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (opts.activeOnly) q = q.in("status", ["awaiting_payment", "open", "matched", "in_progress", "check", "disputed"]);
  const { data, error } = await q.returns<(DealRow & { offers: { count: number }[] })[]>();
  if (error) throw new Error(error.message);

  const items: TaskListItem[] = [];
  for (const row of data ?? []) {
    const deal = (await settle(dealFromRow(row))) as ErrandDeal;
    if (opts.activeOnly && ["released", "refunded", "cancelled", "expired"].includes(deal.status)) continue;
    items.push({ deal, offerCount: row.offers?.[0]?.count ?? 0 });
  }
  return items;
}

export interface PublicProfile {
  id: string;
  name: string;
  rating: number | null;
  rating_count: number;
  completed_count: number;
  kyc_level: number;
}

/** Trust-card info for a set of users (never phone numbers). */
export async function publicProfiles(ids: (string | null | undefined)[]): Promise<Map<string, PublicProfile>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const { data, error } = await createAdminClient()
    .from("public_profiles")
    .select("id, name, rating, rating_count, completed_count, kyc_level")
    .in("id", unique)
    .returns<PublicProfile[]>();
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.id, p]));
}

export interface TimelineItem {
  code: string;
  data: Record<string, unknown>;
  at: number;
}

export async function timeline(dealId: string): Promise<TimelineItem[]> {
  const { data, error } = await createAdminClient()
    .from("timeline_events")
    .select("code, data, created_at")
    .eq("deal_id", dealId)
    .order("id")
    .returns<{ code: string; data: Record<string, unknown>; created_at: string }[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({ code: e.code, data: e.data, at: Date.parse(e.created_at) }));
}

/** Stars the viewer gave on this deal, or null if not rated yet. */
export async function myRating(dealId: string, viewerId: string): Promise<number | null> {
  const { data, error } = await createAdminClient()
    .from("ratings")
    .select("stars")
    .eq("deal_id", dealId)
    .eq("from_user_id", viewerId)
    .maybeSingle<{ stars: number }>();
  if (error) throw new Error(error.message);
  return data?.stars ?? null;
}

/** Deals waiting on this customer (check window open) — the red dot on the History tab. */
export async function countNeedsAction(viewerId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", viewerId)
    .eq("status", "check");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface WalletEntry {
  dealId: string | null;
  kind: string;
  /** Signed from the viewer's point of view: + money to them, − money from them. */
  amount: number;
  at: number;
}

/** Ledger lines touching the viewer's own accounts (ext:/payable:), newest first. */
export async function walletEntries(viewerId: string): Promise<WalletEntry[]> {
  const mine = [`ext:${viewerId}`, `payable:${viewerId}`];
  const { data, error } = await createAdminClient()
    .from("ledger_entries")
    .select("deal_id, kind, amount, from_account, to_account, created_at")
    .or(`from_account.in.(${mine.join(",")}),to_account.in.(${mine.join(",")})`)
    .order("id", { ascending: false })
    .limit(100)
    .returns<{ deal_id: string | null; kind: string; amount: number; from_account: string; to_account: string; created_at: string }[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({
    dealId: e.deal_id,
    kind: e.kind,
    amount: mine.includes(e.to_account) ? Number(e.amount) : -Number(e.amount),
    at: Date.parse(e.created_at),
  }));
}

/** Deals the viewer works on as a helper (helper history / earnings). */
export async function listMyJobs(viewerId: string): Promise<ErrandDeal[]> {
  const { data, error } = await createAdminClient()
    .from("deals")
    .select("*")
    .eq("type", "errand")
    .eq("helper_id", viewerId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<DealRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => dealFromRow(r) as ErrandDeal);
}
