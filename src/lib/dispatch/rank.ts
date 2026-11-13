import "server-only";
import { runCommand } from "@/lib/db/deals";
import { DEFAULT_CONFIG, MINUTE_MS, liveOffers, type ErrandDeal } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { distanceKm, score } from "./plan";

/** Max applications a helper may have open at once (docs/decisions.md 2026-11-13). */
export const MAX_PENDING_APPLICATIONS = 3;

export interface RankedApplicant {
  helperId: string;
  score: number;
  distanceKm: number | null;
}

/**
 * Orders a task's live applicants with the same score as dispatch (close and good). The first
 * one gets the "Recommended" badge, and "Choose for me" picks it.
 */
export async function rankApplicants(deal: ErrandDeal, now = Date.now()): Promise<RankedApplicant[]> {
  const ids = liveOffers(deal, now).map((o) => o.helperId);
  if (!ids.length) return [];
  const db = createAdminClient();
  const since = new Date(now - 30 * 24 * 60 * MINUTE_MS).toISOString();
  const [profiles, presence, offers] = await Promise.all([
    db.from("profiles").select("id, rating_sum, rating_count, completed_count").in("id", ids),
    db.from("helper_presence").select("user_id, lat, lng").in("user_id", ids),
    db.from("dispatch_offers").select("helper_id, status").in("helper_id", ids).gt("sent_at", since),
  ]);
  const pos = new Map((presence.data ?? []).map((p) => [p.user_id as string, p]));
  return (profiles.data ?? [])
    .map((p) => {
      const at = pos.get(p.id as string);
      const km = deal.location && at?.lat != null && at.lng != null ? distanceKm(deal.location, { lat: at.lat, lng: at.lng }) : null;
      const mine = (offers.data ?? []).filter((o) => o.helper_id === p.id);
      return {
        helperId: p.id as string,
        distanceKm: km,
        score: score({
          helperId: p.id as string,
          distanceKm: km,
          ratingSum: Number(p.rating_sum),
          ratingCount: Number(p.rating_count),
          completed: Number(p.completed_count),
          offers30d: mine.length,
          won30d: mine.filter((o) => o.status === "won").length,
        }),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** How many applications this helper has standing on open tasks right now. */
export async function pendingApplications(helperId: string, now = Date.now()): Promise<number> {
  const { data } = await createAdminClient()
    .from("offers")
    .select("created_at, deals!inner(status, mode)")
    .eq("helper_id", helperId)
    .eq("deals.status", "open")
    .returns<{ created_at: string; deals: { status: string; mode: string } }[]>();
  const lapse = DEFAULT_CONFIG.applicationMinutes * MINUTE_MS;
  return (data ?? []).filter((o) => o.deals.mode !== "now" || now - Date.parse(o.created_at) < lapse).length;
}

/**
 * The helper was paid for `dealId`, so they're busy: withdraw their other applications and step
 * back from any other task still waiting for payment (no penalty — nothing was paid there).
 */
export async function releaseOtherCommitments(helperId: string, dealId: string): Promise<void> {
  const db = createAdminClient();
  const [applied, assigned] = await Promise.all([
    db.from("offers").select("deal_id, deals!inner(status)").eq("helper_id", helperId).eq("deals.status", "open").neq("deal_id", dealId),
    db.from("deals").select("id").eq("helper_id", helperId).eq("status", "awaiting_payment").neq("id", dealId),
  ]);
  const system = { kind: "system" } as const;
  const helper = { kind: "user", id: helperId, role: "helper" } as const;
  for (const o of applied.data ?? []) {
    await runCommand(db, o.deal_id as string, { type: "withdraw_offer", helperId }, system).catch(() => {});
  }
  for (const d of assigned.data ?? []) {
    await runCommand(db, d.id as string, { type: "cancel" }, helper).catch(() => {});
  }
}
