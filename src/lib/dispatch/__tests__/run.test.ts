import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), rules: vi.fn(), failure: "", writes: vi.fn(), run: vi.fn(), rank: vi.fn(), pickAt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/deals", async (original) => ({ ...(await original<object>()), loadDeal: mocks.load, runCommand: mocks.run }));
vi.mock("../rank", () => ({ rankApplicants: mocks.rank }));
vi.mock("@/lib/engine", async (original) => {
  const engine = await original<typeof import("@/lib/engine")>();
  return { ...engine, autoPickAt: (...a: Parameters<typeof engine.autoPickAt>) => mocks.pickAt(...a) ?? engine.autoPickAt(...a) };
});
vi.mock("@/lib/rules", () => ({ getRules: mocks.rules }));
vi.mock("@/lib/push", () => ({ notify: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: () => q,
        upsert: () => {
          mocks.writes();
          return q;
        },
        update: () => {
          mocks.writes();
          return q;
        },
        throwOnError: async () => {
          if (mocks.failure === table) throw new Error("database unavailable");
          return { data: null };
        },
      };
      return q;
    },
  }),
}));
import { openDealIds, runDispatch } from "../run";
import { World } from "../../engine/__tests__/helpers";
import { DbError } from "@/lib/db/deals";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.failure = "";
  const w = new World();
  mocks.load.mockResolvedValue(w.get(w.post()));
});
it("does not report a failed dispatch queue as empty", async () => {
  mocks.failure = "deals";
  await expect(openDealIds()).rejects.toThrow("database unavailable");
});
it("does not restart waves when the stored dispatch state cannot be read", async () => {
  mocks.failure = "dispatch_state";
  await expect(runDispatch("task")).rejects.toThrow("database unavailable");
  expect(mocks.writes).not.toHaveBeenCalled();
});
it("does not substitute built-in dispatch rules when the live settings fail", async () => {
  mocks.rules.mockRejectedValue(new Error("rules unavailable"));
  await expect(runDispatch("task")).rejects.toThrow("rules unavailable");
  expect(mocks.writes).not.toHaveBeenCalled();
});

it("tries the next applicant when the database refuses an automatic pick", async () => {
  const deal = await mocks.load();
  mocks.load.mockResolvedValue(deal);
  mocks.pickAt.mockReturnValue(0);
  mocks.rank.mockResolvedValue([{ helperId: "first" }, { helperId: "second" }]);
  mocks.run
    .mockRejectedValueOnce(new DbError({ message: "talk first", code: "23514" }))
    .mockResolvedValueOnce({ deal: { ...deal, status: "matched", helperId: "second" } });
  await runDispatch("task", 1);
  expect(mocks.run.mock.calls.map((c) => c[2])).toEqual([
    { type: "choose", helperId: "first" },
    { type: "choose", helperId: "second" },
  ]);
});
it("leaves the choice to the customer, without failing, when every pick is refused", async () => {
  mocks.pickAt.mockReturnValue(0);
  mocks.rank.mockResolvedValue([{ helperId: "only" }]);
  mocks.run.mockRejectedValue(new DbError({ message: "condition not met", code: "23514" }));
  // the run carries on to the waves (stopped here by an unrelated read): the refusal itself is not an error
  mocks.failure = "dispatch_state";
  await expect(runDispatch("task", 1)).rejects.toThrow("database unavailable");
  expect(mocks.run).toHaveBeenCalledOnce();
});
