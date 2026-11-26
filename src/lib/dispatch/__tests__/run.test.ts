import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), rules: vi.fn(), failure: "", writes: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/deals", async (original) => ({ ...(await original<object>()), loadDeal: mocks.load }));
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
