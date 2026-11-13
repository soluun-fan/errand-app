import "server-only";
import { loadDeal } from "@/lib/db/deals";
import type { ErrandDeal } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";
import { notify } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { CITY_WAVE, WAVES, dueWave, pickWave, type Candidate } from "./plan";

interface CandidateRow {
  helper_id: string;
  distance_km: number | null;
  rating_sum: number;
  rating_count: number;
  completed_count: number;
  offers_30d: number;
  won_30d: number;
}

export interface DispatchStatus {
  wave: number;
  notified: number;
}

/**
 * Advances one task's dispatch (docs/rules.md §Dispatch). Idempotent and safe to call often —
 * after posting, from the customer's "searching…" screen, and from the cron tick:
 * - task no longer open → close the remaining offers (the post leaves every feed)
 * - otherwise send the next wave if it is due; an empty wave widens straight away
 * Duplicate offers are impossible (primary key); a race can at worst send a wave early.
 */
export async function runDispatch(dealId: string, now = Date.now()): Promise<DispatchStatus | null> {
  const db = createAdminClient();
  const deal = await loadDeal(db, dealId);
  if (!deal || deal.type !== "errand") return null;

  const { data: state } = await db
    .from("dispatch_state")
    .select("wave, wave_started_at, notified")
    .eq("deal_id", dealId)
    .maybeSingle<{ wave: number; wave_started_at: string; notified: number }>();

  if (deal.status !== "open") {
    await closeOffers(dealId, deal.helperId);
    return state ? { wave: state.wave, notified: state.notified } : null;
  }

  let wave = state?.wave ?? -1;
  let startedAt = state ? Date.parse(state.wave_started_at) : null;
  let notified = state?.notified ?? 0;

  for (;;) {
    const due = dueWave(wave, startedAt, now);
    if (due === null) break;
    const { data, error } = await db.rpc("dispatch_candidates", {
      p_deal_id: dealId,
      p_max_km: WAVES[due].radiusKm,
      p_now: new Date(now).toISOString(),
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CandidateRow[];
    const { data: offered } = await db.from("dispatch_offers").select("helper_id").eq("deal_id", dealId);
    const picks = pickWave(rows.map(toCandidate), due, new Set((offered ?? []).map((o) => o.helper_id as string)));

    const expires = due === CITY_WAVE ? (deal.matchBy ?? now + 30 * 60_000) : now + WAVES[due].seconds * 1000;
    if (picks.length) {
      await db
        .from("dispatch_offers")
        .upsert(
          picks.map((p) => ({
            deal_id: dealId,
            helper_id: p.helperId,
            wave: due,
            distance_km: p.distanceKm,
            score: p.score,
            sent_at: new Date(now).toISOString(),
            expires_at: new Date(expires).toISOString(),
          })),
          { onConflict: "deal_id,helper_id", ignoreDuplicates: true },
        )
        .throwOnError();
    }
    wave = due;
    startedAt = now;
    notified += picks.length;
    await db
      .from("dispatch_state")
      .upsert({ deal_id: dealId, wave, wave_started_at: new Date(now).toISOString(), notified })
      .throwOnError();
    if (picks.length) {
      await notifyHelpers(deal, picks.map((p) => p.helperId));
      break; // give this wave its time before widening
    }
  }
  return { wave, notified };
}

function toCandidate(r: CandidateRow): Candidate {
  return {
    helperId: r.helper_id,
    distanceKm: r.distance_km === null ? null : Number(r.distance_km),
    ratingSum: Number(r.rating_sum),
    ratingCount: Number(r.rating_count),
    completed: Number(r.completed_count),
    offers30d: Number(r.offers_30d),
    won30d: Number(r.won_30d),
  };
}

async function notifyHelpers(deal: ErrandDeal, helperIds: string[]) {
  await notify(helperIds, {
    title: deal.mode === "now" ? "push.newJobTitle" : "push.newRequestTitle",
    body: "push.newJobBody",
    params: { title: deal.title, fee: fmtMoney(deal.fee) },
    url: `/jobs/${deal.id}`,
    tag: `job-${deal.id}`,
  });
}

/** The task left "open": the winner's offer is marked won, everyone else's closes. */
async function closeOffers(dealId: string, winner: string | null) {
  const db = createAdminClient();
  if (winner) await db.from("dispatch_offers").update({ status: "won" }).eq("deal_id", dealId).eq("helper_id", winner);
  await db.from("dispatch_offers").update({ status: "closed" }).eq("deal_id", dealId).eq("status", "sent");
}

/** Every open task whose dispatch may need the next wave (for the cron tick). */
export async function openDealIds(limit = 200): Promise<string[]> {
  const { data } = await createAdminClient()
    .from("deals")
    .select("id")
    .eq("type", "errand")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => r.id as string);
}
