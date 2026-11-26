import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn(), position: vi.fn(), rules: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "user-agent": "iPhone" }),
}));
vi.mock("@/lib/rules", () => ({ getRules: mocks.rules }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () => query,
        throwOnError: () => (table === "push_subscriptions" ? mocks.push() : mocks.position()),
      };
      return query;
    },
  }),
}));
import { workReadyMissing } from "../work-ready";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("E2E_DEVICE_BYPASS", "");
  mocks.push.mockResolvedValue({ count: 1 });
  mocks.position.mockResolvedValue({ data: { lat: 47.9, updated_at: new Date().toISOString() } });
  mocks.rules.mockResolvedValue({ readyPositionMinutes: 15 });
});
afterEach(() => vi.unstubAllEnvs());

it("accepts a ready device", async () => {
  await expect(workReadyMissing({ id: "helper" })).resolves.toEqual([]);
});
it.each(["push", "position", "rules"] as const)("does not ask the helper to fix their device when %s is unavailable", async (name) => {
  mocks[name].mockRejectedValue(new Error("database unavailable"));
  await expect(workReadyMissing({ id: "helper" })).rejects.toThrow("database unavailable");
});
it("still identifies genuinely missing notification and location setup", async () => {
  mocks.push.mockResolvedValue({ count: 0 });
  mocks.position.mockResolvedValue({ data: null });
  await expect(workReadyMissing({ id: "helper" })).resolves.toEqual(["notifications", "location"]);
});
