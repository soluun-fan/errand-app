import { timingSafeEqual } from "node:crypto";
import { heartbeat, withLease } from "@/lib/scheduler";
import { runTick } from "@/lib/tick";

/**
 * Background tick, called every 20 s by Supabase pg_cron (migration 20261115020000) or by
 * `npm run cron:local` in development, with `Authorization: Bearer $CRON_SECRET`.
 * A database lease means overlapping calls skip instead of running twice; each run writes a
 * heartbeat (last success / error) to `system_heartbeats`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const got = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
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
