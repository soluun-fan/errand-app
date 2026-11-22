/** Read-only deployment checks. No user rows, positions, phone numbers or keys are printed. */
import { createClient } from "@supabase/supabase-js";
import { tickHealth, type HeartbeatRow } from "../src/lib/health-rules";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  const db = createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }) },
  });
  let failed = false;
  for (const [table, columns] of [
    ["job_locations", "deal_id,helper_id,lat,lng,updated_at"],
    ["helper_presence", "user_id,online,lat,lng,updated_at"],
    ["recipient_verifications", "deal_id,owner_id,status"],
  ]) {
    // HEAD can hide PostgREST's missing-table error. A zero-row GET checks the actual API schema.
    const { error } = await db.from(table).select(columns).limit(0);
    console.log(`${error ? "FAIL" : "OK"} ${table}${error ? ` (${error.code || "connection failed"})` : ""}`);
    failed ||= Boolean(error);
  }
  const { data, error } = await db.rpc("scheduler_status");
  if (error) {
    console.log(`FAIL scheduler (${error.code || "connection failed"})`);
    failed = true;
  } else {
    const configured = Boolean(data?.tick_url && data?.secret_set && data?.job?.active);
    const healthy = tickHealth((data?.heartbeat ?? null) as HeartbeatRow | null, Date.now()).state === "ok";
    console.log(`${configured && healthy ? "OK" : "FAIL"} scheduler: ${configured ? "configured" : "not configured"}, ${healthy ? "recent successful tick" : "no recent successful tick"}`);
    failed ||= !configured || !healthy;
    // pg_cron "succeeded" only means the request was queued; the HTTP result says if the app ran it.
    const http = (data?.recent_http ?? []) as { status_code: number | null; timed_out: boolean | null }[];
    if (!healthy && http.length) {
      const codes = http.map((r) => (r.timed_out ? "timeout" : String(r.status_code ?? "error"))).join(", ");
      const hint = http.some((r) => r.status_code === 401)
        ? " → 401: the scheduler secret in Supabase doesn't match CRON_SECRET on the host; run `npm run scheduler:configure -- https://<domain>` with the host's CRON_SECRET in .env.local"
        : "";
      console.log(`     last tick calls: ${codes}${hint}`);
    }
  }
  if (failed) process.exitCode = 1;
}

void main().catch(() => { console.error("Live checks failed. Check the configured database URL, credentials and connection."); process.exitCode = 1; });
