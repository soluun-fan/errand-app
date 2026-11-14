import { timingSafeEqual } from "node:crypto";
import { openDealIds, runDispatch } from "@/lib/dispatch/run";
import { purgeOldSignals } from "@/lib/calls";
import { purgeExpiredChats } from "@/lib/chat";
import { settleDueDeals } from "@/lib/deals/queries";

/**
 * Background tick (docs/rules.md §Background jobs): call every 15–60 s from a scheduler
 * (Supabase pg_cron + pg_net, or any cron) with `Authorization: Bearer $CRON_SECRET`.
 * 1. runs what is due: payment-window lapses, no-helper expiry, auto-release
 * 2. advances dispatch waves for open tasks
 * 3. deletes chats (and their photos) 90 days after a task ended
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
  await purgeOldSignals(now).catch((e) => console.error("signal purge failed", e));
  const chatsPurged = await purgeExpiredChats(now).catch((e) => {
    console.error("chat purge failed", e);
    return 0;
  });
  return Response.json({ settled, dispatched: waves, chatsPurged, at: new Date(now).toISOString() });
}
