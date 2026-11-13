import { timingSafeEqual } from "node:crypto";
import { openDealIds, runDispatch } from "@/lib/dispatch/run";
import { settleDueDeals } from "@/lib/deals/queries";

/**
 * Background tick (docs/rules.md §Background jobs): call every 15–60 s from a scheduler
 * (Supabase pg_cron + pg_net, or any cron) with `Authorization: Bearer $CRON_SECRET`.
 * 1. runs what is due: payment-window lapses, no-helper expiry, auto-release
 * 2. advances dispatch waves for open tasks
 * Everything here is idempotent; screens also trigger the same work lazily.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const got = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const now = Date.now();
  const settled = await settleDueDeals(now);
  let waves = 0;
  for (const id of await openDealIds()) {
    try {
      const before = await runDispatch(id, now);
      if (before) waves++;
    } catch (e) {
      console.error("dispatch failed", id, e);
    }
  }
  return Response.json({ settled, dispatched: waves, at: new Date(now).toISOString() });
}
