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
import { markLateHelpers, nudgeStaleLocations, purgeIdlePresence, purgeJobRoutes } from "@/lib/standards-tick";

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
  const failures: { job: string; error: unknown }[] = [];
  async function step<T>(job: string, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (error) {
      failures.push({ job, error });
      console.error(`${job} failed`, error);
      return fallback;
    }
  }
  // first: an SOS reminder must never wait behind a slow dispatch round
  const sosReminders = await step("SOS reminders", () => repingSos(now), 0);
  const settled = await step("task settlement", () => settleDueDeals(now), 0);
  // helper standards: late helpers are marked (and both sides told); stopped locations get a reminder
  const lateMarked = await step("late helper marking", () => markLateHelpers(now), 0);
  await step("location reminders", () => nudgeStaleLocations(now), undefined);
  let dispatched = 0;
  let failedDispatch = 0;
  for (const id of await step("dispatch queue", () => openDealIds(), [])) {
    try {
      if (await runDispatch(id, now)) dispatched++;
    } catch (e) {
      failedDispatch++;
      failures.push({ job: "dispatch", error: e });
      console.error("dispatch failed", id, e);
    }
  }
  await step("signal retention", () => purgeOldSignals(now), undefined);
  const kycPurged = await step("identity document retention", () => purgeKycFiles(now), 0);
  const chatsPurged = await step("chat retention", () => purgeExpiredChats(now), 0);
  await step("incident location retention", () => purgeIncidentLocations(now), undefined);
  const photosPurged = await step("task photo retention", () => purgeLooseTaskPhotos(now), 0);
  await step("review photo retention", () => purgeLooseReviewPhotos(now), undefined);
  await step("route retention", () => purgeJobRoutes(), undefined);
  await step("presence retention", () => purgeIdlePresence(now), undefined);
  // earnings unclaimed for N days are asked for automatically (V1 spec A4)
  await step("payout requests", () => runAutoPayouts(), undefined);
  // refunds the ledger holds that wire hasn't done yet (new ones and retries)
  await step("refund reconciliation", () => sweepRefunds(), undefined);
  // Finish independent work, then fail the run so /api/health and Ops cannot claim
  // that retries, safety reminders or retention succeeded when they did not.
  if (failures.length) {
    throw new AggregateError(
      failures.map((f) => f.error),
      `Background jobs failed: ${[...new Set(failures.map((f) => f.job))].join(", ")}`,
    );
  }
  return { settled, dispatched, failedDispatch, chatsPurged, kycPurged, photosPurged, sosReminders, lateMarked, ms: Date.now() - t0 };
}
