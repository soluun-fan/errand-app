import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingTable, type JobLocation, type WorkerLocationState } from "./location-rules";

/** Caller supplies the authenticated helper's ID, never an ID from browser input. */
export async function workerLocationState(helperId: string): Promise<WorkerLocationState> {
  const db = createAdminClient();
  const [presence, jobs] = await Promise.all([
    db.from("helper_presence").select("online").eq("user_id", helperId).maybeSingle<{ online: boolean }>().throwOnError(),
    // running jobs, and jobs the helper is on the way to ("On my way", 2026-11-24)
    db.from("job_locations").select("deal_id, deals!inner(status, helper_id, en_route_at)")
      .eq("helper_id", helperId).eq("deals.helper_id", helperId).in("deals.status", ["in_progress", "matched"])
      .returns<{ deal_id: string; deals: { status: string; en_route_at: string | null } }[]>(),
  ]);
  if (jobs.error && !missingTable(jobs.error, "job_locations")) throw jobs.error;
  const live = (jobs.data ?? []).filter((j) => j.deals.status === "in_progress" || j.deals.en_route_at !== null);
  return { online: presence.data?.online === true, available: !jobs.error, jobIds: live.map((j) => j.deal_id) };
}

export async function saveWorkerLocation(helperId: string, pos: { lat: number; lng: number }): Promise<WorkerLocationState> {
  const state = await workerLocationState(helperId);
  const db = createAdminClient();
  const sample = { ...pos, updated_at: new Date().toISOString() };
  if (state.online) await db.from("helper_presence").update(sample).eq("user_id", helperId).eq("online", true).throwOnError();
  // Running jobs: live position + a route point for disputes (helper standards, 2026-11-22). The
  // database only touches jobs in progress and assigned to this helper; ending a job stops it.
  if (state.jobIds.length) await db.rpc("record_job_position", { p_helper: helperId, p_lat: pos.lat, p_lng: pos.lng }).throwOnError();
  return state;
}

/** Customer-only read. Rechecks ownership and current assignment before reading a position. */
export async function customerJobLocation(dealId: string, customerId: string): Promise<JobLocation> {
  const db = createAdminClient();
  const { data: deal } = await db.from("deals").select("helper_id, status, en_route_at")
    .eq("id", dealId).eq("customer_id", customerId).eq("type", "errand")
    .maybeSingle<{ helper_id: string | null; status: string; en_route_at?: string | null }>().throwOnError();
  const tracked = deal?.status === "in_progress" || (deal?.status === "matched" && Boolean(deal.en_route_at));
  if (!deal?.helper_id || !tracked) return { available: true, sharing: false, position: null };
  const { data, error } = await db.from("job_locations").select("lat, lng, updated_at")
    .eq("deal_id", dealId).eq("helper_id", deal.helper_id)
    .maybeSingle<{ lat: number | null; lng: number | null; updated_at: string }>();
  if (missingTable(error, "job_locations")) return { available: false, sharing: false, position: null };
  if (error) throw error;
  return {
    available: true,
    sharing: Boolean(data),
    position: data?.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng, updatedAt: Date.parse(data.updated_at) } : null,
  };
}
