import { timingSafeEqual } from "node:crypto";
import { heartbeat, withLease } from "@/lib/scheduler";
import { runTick } from "@/lib/tick";

/**
 * Background tick, called every 20 s by Supabase pg_cron (migration 20261115020000) or by
 * `npm run cron:local` in development, with `Authorization: Bearer $CRON_SECRET`.
 * A database lease means overlapping calls skip instead of running twice; each run writes a
 * heartbeat (last success / error) to `system_heartbeats`.
 */
/** Give a busy tick time to finish on serverless hosting (default limits can be ~10 s). */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // A host without the secret rejects every scheduled call; say so where Ops and /api/health look
    // (2026-11-22: this went unnoticed for a week because a bare 401 left no trace).
    await heartbeat("tick", { ok: false, error: "CRON_SECRET is not set on the server" }).catch(() => {});
    return new Response("Scheduler not configured", { status: 503 });
  }
  const got = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const provided = Buffer.from(got);
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const run = await withLease("tick", 120, () => runTick());
    if (!run.ran) return Response.json({ skipped: "another tick is running" });
    await heartbeat("tick", { ok: true, result: run.result });
    return Response.json(run.result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await heartbeat("tick", { ok: false, error: message }).catch(() => {});
    console.error("tick failed", e);
    return Response.json({ error: "tick failed" }, { status: 500 });
  }
}
