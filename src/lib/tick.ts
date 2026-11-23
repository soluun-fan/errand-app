import "server-only";
import { purgeOldSignals } from "@/lib/calls";
import { purgeExpiredChats } from "@/lib/chat";
import { settleDueDeals } from "@/lib/deals/queries";
import { openDealIds, runDispatch } from "@/lib/dispatch/run";
import { purgeIncidentLocations, repingSos } from "@/lib/incidents";
import { purgeKycFiles } from "@/lib/kyc";
import { purgeLooseTaskPhotos } from "@/lib/task-photos";
import { purgeLooseReviewPhotos } from "@/lib/work-photos";
import { runAutoPayouts } from "@/lib/withdrawals";
import { sweepRefunds } from "@/lib/payments/service";
import { markLateHelpers, nudgeStaleLocations, purgeJobRoutes } from "@/lib/standards-tick";

export interface TickResult {
  settled: number;
  dispatched: number;
  failedDispatch: number;
  chatsPurged: number;
  kycPurged: number;
  photosPurged: number;
  sosReminders: number;
  lateMarked: number;
  ms: number;
}

/**
 * One background tick (docs/rules.md §Background jobs). Every step is idempotent and isolated:
 * one failing task or purge never stops the rest.
 * 1. what is due: payment-window lapses, no-helper expiry, auto-release
 * 2. dispatch waves (and "Choose for me") for open tasks
 * 3. safety: remind Ops about an SOS nobody has acknowledged yet
 * 4. retention: call signals after 1 h, ID documents 30 days after the decision, chats 90 days
 *    after the task, incident positions 30 days after resolution, task photos never posted after 1 day
 */
export async function runTick(now = Date.now()): Promise<TickResult> {
  const t0 = Date.now();
  // first: an SOS reminder must never wait behind a slow dispatch round
  const sosReminders = await repingSos(now).catch((e) => (console.error("sos reminder failed", e), 0));
  const settled = await settleDueDeals(now);
  // helper standards: late helpers are marked (and both sides told); stopped locations get a reminder
  const lateMarked = await markLateHelpers(now).catch((e) => (console.error("late marking failed", e), 0));
  await nudgeStaleLocations(now).catch((e) => console.error("location reminder failed", e));
  let dispatched = 0;
  let failedDispatch = 0;
  for (const id of await openDealIds()) {
    try {
      if (await runDispatch(id, now)) dispatched++;
    } catch (e) {
      failedDispatch++;
      console.error("dispatch failed", id, e);
    }
  }
  await purgeOldSignals(now).catch((e) => console.error("signal purge failed", e));
  const kycPurged = await purgeKycFiles(now).catch((e) => (console.error("kyc purge failed", e), 0));
  const chatsPurged = await purgeExpiredChats(now).catch((e) => (console.error("chat purge failed", e), 0));
  await purgeIncidentLocations(now).catch((e) => console.error("incident purge failed", e));
  const photosPurged = await purgeLooseTaskPhotos(now).catch((e) => (console.error("task photo purge failed", e), 0));
  await purgeLooseReviewPhotos(now).catch((e) => console.error("review photo purge failed", e));
  await purgeJobRoutes().catch((e) => console.error("route purge failed", e));
  // earnings unclaimed for N days are asked for automatically (V1 spec A4)
  await runAutoPayouts().catch((e) => console.error("auto payouts failed", e));
  // refunds the ledger holds that wire hasn't done yet (new ones and retries)
  await sweepRefunds().catch((e) => console.error("refund sweep failed", e));
  return { settled, dispatched, failedDispatch, chatsPurged, kycPurged, photosPurged, sosReminders, lateMarked, ms: Date.now() - t0 };
}
