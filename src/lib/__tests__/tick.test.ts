import { afterEach, beforeEach, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  repingSos: vi.fn(),
  settleDueDeals: vi.fn(),
  markLateHelpers: vi.fn(),
  nudgeStaleLocations: vi.fn(),
  openDealIds: vi.fn(),
  runDispatch: vi.fn(),
  purgeOldSignals: vi.fn(),
  purgeKycFiles: vi.fn(),
  purgeExpiredChats: vi.fn(),
  purgeIncidentLocations: vi.fn(),
  purgeLooseTaskPhotos: vi.fn(),
  purgeLooseReviewPhotos: vi.fn(),
  purgeJobRoutes: vi.fn(),
  purgeIdlePresence: vi.fn(),
  runAutoPayouts: vi.fn(),
  sweepRefunds: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/calls", () => ({ purgeOldSignals: jobs.purgeOldSignals }));
vi.mock("@/lib/chat", () => ({ purgeExpiredChats: jobs.purgeExpiredChats }));
vi.mock("@/lib/deals/queries", () => ({ settleDueDeals: jobs.settleDueDeals }));
vi.mock("@/lib/dispatch/run", () => ({ openDealIds: jobs.openDealIds, runDispatch: jobs.runDispatch }));
vi.mock("@/lib/incidents", () => ({ repingSos: jobs.repingSos, purgeIncidentLocations: jobs.purgeIncidentLocations }));
vi.mock("@/lib/kyc", () => ({ purgeKycFiles: jobs.purgeKycFiles }));
vi.mock("@/lib/task-photos", () => ({ purgeLooseTaskPhotos: jobs.purgeLooseTaskPhotos }));
vi.mock("@/lib/work-photos", () => ({ purgeLooseReviewPhotos: jobs.purgeLooseReviewPhotos }));
vi.mock("@/lib/withdrawals", () => ({ runAutoPayouts: jobs.runAutoPayouts }));
vi.mock("@/lib/payments/service", () => ({ sweepRefunds: jobs.sweepRefunds }));
vi.mock("@/lib/standards-tick", () => ({
  markLateHelpers: jobs.markLateHelpers,
  nudgeStaleLocations: jobs.nudgeStaleLocations,
  purgeJobRoutes: jobs.purgeJobRoutes,
  purgeIdlePresence: jobs.purgeIdlePresence,
}));
import { runTick } from "../tick";

beforeEach(() => {
  vi.resetAllMocks();
  for (const job of Object.values(jobs)) job.mockResolvedValue(0);
  jobs.openDealIds.mockResolvedValue(["first", "second"]);
  jobs.runDispatch.mockResolvedValue({ wave: 1, notified: 2 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("reports successful work and passes the same clock to timed jobs", async () => {
  jobs.settleDueDeals.mockResolvedValue(3);
  await expect(runTick(123)).resolves.toMatchObject({ settled: 3, dispatched: 2, failedDispatch: 0 });
  expect(jobs.settleDueDeals).toHaveBeenCalledWith(123);
  expect(jobs.repingSos).toHaveBeenCalledWith(123);
});

it.each(["repingSos", "settleDueDeals", "openDealIds", "purgeKycFiles", "sweepRefunds"] as const)(
  "finishes independent jobs but reports failure when %s fails",
  async (name) => {
    jobs[name].mockRejectedValue(new Error("database unavailable"));
    await expect(runTick()).rejects.toBeInstanceOf(AggregateError);
    for (const [key, job] of Object.entries(jobs)) {
      if (key !== "runDispatch" || name !== "openDealIds") expect(job, key).toHaveBeenCalled();
    }
  },
);

it("continues dispatching other tasks and running retention after a single dispatch fails", async () => {
  jobs.runDispatch.mockRejectedValueOnce(new Error("failed first task"));
  await expect(runTick()).rejects.toThrow("dispatch");
  expect(jobs.runDispatch).toHaveBeenCalledTimes(2);
  expect(jobs.purgeKycFiles).toHaveBeenCalledOnce();
  expect(jobs.sweepRefunds).toHaveBeenCalledOnce();
});
