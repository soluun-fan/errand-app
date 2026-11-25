import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  results: [] as { data?: unknown; count?: number | null; error: { message: string } | null }[],
  writes: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/push", () => ({ notify: vi.fn() }));
vi.mock("@/lib/safety", () => ({ audit: vi.fn(), adminIds: async () => [] }));
vi.mock("@/lib/orgs", () => ({ signedUrl: async () => "signed-url" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const result = mocks.results.shift() ?? { data: [], error: null };
      const q = {
        select: () => q,
        eq: () => q,
        gt: () => q,
        order: () => q,
        limit: () => q,
        in: () => q,
        returns: () => q,
        maybeSingle: () => q,
        insert: mocks.writes,
        throwOnError: () => (result.error ? Promise.reject(new Error(result.error.message)) : Promise.resolve(result)),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      };
      return q;
    },
  }),
}));

import { badgeQueue, myBadges } from "../badges";
import { getSupportSettings, openSupportCount, sendSupportRequest } from "../support";

beforeEach(() => {
  mocks.results.length = 0;
  mocks.writes.mockClear();
});

it.each([getSupportSettings, openSupportCount, badgeQueue, () => myBadges("helper")])(
  "surfaces a database failure instead of an empty screen",
  async (read) => {
    mocks.results.push({ data: null, error: { message: "database unavailable" } });
    await expect(read()).rejects.toThrow("database unavailable");
  },
);

it("does not bypass the support request limit when the count fails", async () => {
  mocks.results.push({ count: null, error: { message: "count unavailable" } });
  await expect(sendSupportRequest("user", "task", "Please help with my task")).rejects.toThrow("count unavailable");
  expect(mocks.writes).not.toHaveBeenCalled();
});

it("keeps a valid empty badge queue distinct from a failed read", async () => {
  mocks.results.push({ data: [], error: null });
  await expect(badgeQueue()).resolves.toEqual([]);
});

it("reports a missing settings row instead of silently clearing contact details", async () => {
  mocks.results.push({ data: null, error: null });
  await expect(getSupportSettings()).rejects.toThrow("support_settings row missing");
});
