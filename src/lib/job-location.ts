import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingTable, type JobLocation, type WorkerLocationState } from "./location-rules";

/** Caller supplies the authenticated helper's ID, never an ID from browser input. */
export async function workerLocationState(helperId: string): Promise<WorkerLocationState> {
  const db = createAdminClient();
  const [presence, jobs] = await Promise.all([
    db.from("helper_presence").select("online").eq("user_id", helperId).maybeSingle<{ online: boolean }>().throwOnError(),
    db.from("job_locations").select("deal_id, deals!inner(status, helper_id)")
      .eq("helper_id", helperId).eq("deals.helper_id", helperId).eq("deals.status", "in_progress"),
  ]);
  if (jobs.error && !missingTable(jobs.error, "job_locations")) throw jobs.error;
  return { online: presence.data?.online === true, available: !jobs.error, jobIds: (jobs.data ?? []).map(j => j.deal_id) };
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
  const { data: deal } = await db.from("deals").select("helper_id, status")
    .eq("id", dealId).eq("customer_id", customerId).eq("type", "errand")
    .maybeSingle<{ helper_id: string | null; status: string }>().throwOnError();
  if (!deal?.helper_id || deal.status !== "in_progress") return { available: true, sharing: false, position: null };
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
