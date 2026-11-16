import "server-only";
import type { HeartbeatRow } from "@/lib/health-rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Background-job plumbing (docs/decisions.md 2026-11-15): a database lease so only one tick runs
 * at a time (pg_cron, the local runner and a manual call can overlap), and a heartbeat row so we
 * can see that the scheduler is alive and what its last run did.
 */
export async function withLease<T>(name: string, seconds: number, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("try_lease", { p_name: name, p_seconds: seconds });
  if (error) throw new Error(error.message);
  if (data !== true) return { ran: false };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await db.rpc("release_lease", { p_name: name });
  }
}

/** The tick's heartbeat row (null before the first run). */
export async function tickHeartbeat(): Promise<HeartbeatRow | null> {
  const { data, error } = await createAdminClient()
    .from("system_heartbeats")
    .select("last_run_at, last_ok_at, last_error")
    .eq("name", "tick")
    .maybeSingle<HeartbeatRow>();
  if (error) throw new Error(error.message);
  return data;
}

export async function heartbeat(name: string, outcome: { ok: true; result: unknown } | { ok: false; error: string }): Promise<void> {
  const now = new Date().toISOString();
  await createAdminClient()
    .from("system_heartbeats")
    .upsert(
      outcome.ok
        ? { name, last_run_at: now, last_ok_at: now, last_error: null, last_result: outcome.result }
        : { name, last_run_at: now, last_error: outcome.error.slice(0, 1000) },
    );
}
