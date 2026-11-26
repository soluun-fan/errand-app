import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ results: [] as { data?: unknown; error?: Error }[], getIntent: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/payments/wire", async (original) => ({ ...(await original<object>()), getIntent: mocks.getIntent }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const result = mocks.results.shift() ?? { data: [] };
      const q = {
        select: () => q,
        eq: () => q,
        or: () => q,
        in: () => q,
        gte: () => q,
        limit: () => q,
        order: () => q,
        returns: () => q,
        throwOnError: async () => {
          if (result.error) throw result.error;
          return result;
        },
      };
      return q;
    },
  }),
}));
import { checkWirePayments, sweepRefunds } from "../payments/service";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.results = [];
  vi.stubEnv("PAYMENT_PROVIDER", "wire");
  vi.stubEnv("WIRE_SECRET_KEY", "local-test-key");
  vi.stubEnv("WIRE_WEBHOOK_SECRET", "local-test-secret");
  vi.stubEnv("APP_ENV", "development");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("checks other pending payments but reports an unavailable provider", async () => {
  mocks.results.push({ data: [{ id: "one" }, { id: "two" }] });
  mocks.getIntent.mockRejectedValueOnce(new Error("provider unavailable")).mockResolvedValueOnce({ status: "processing" });
  await expect(checkWirePayments("task")).rejects.toThrow("Wire payment status checks failed");
  expect(mocks.getIntent).toHaveBeenCalledTimes(2);
});
it("does not mistake an unreadable refund queue for no refunds", async () => {
  mocks.results.push({ data: [] }, { error: new Error("read failed") });
  await expect(sweepRefunds()).rejects.toThrow("read failed");
});
it("reports reconciliation errors after continuing to check refunds", async () => {
  mocks.results.push({ data: [{ deal_id: "task" }] }, { data: [{ id: "payment" }] }, { data: [] }, { data: [] });
  mocks.getIntent.mockRejectedValue(new Error("provider unavailable"));
  await expect(sweepRefunds()).rejects.toThrow("Wire reconciliation or refund sweep failed");
  expect(mocks.results).toEqual([]);
});
