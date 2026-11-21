import { beforeEach, expect, it, vi } from "vitest";

const { write, release } = vi.hoisted(() => ({ write: vi.fn(), release: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => ({ upsert: () => ({ throwOnError: write }) }),
  rpc: (name: string) => name === "try_lease" ? Promise.resolve({ data: true }) : { throwOnError: release },
}) }));
import { heartbeat, withLease } from "../scheduler";

beforeEach(() => { vi.resetAllMocks(); });

it("propagates failed heartbeat writes instead of acknowledging a healthy scheduler", async () => {
  write.mockRejectedValue(new Error("heartbeat write failed"));
  await expect(heartbeat("tick", { ok: true, result: {} })).rejects.toThrow("heartbeat write failed");
});

it("always releases the lease, including when the job throws", async () => {
  await expect(withLease("tick", 120, async () => { throw new Error("job failed"); })).rejects.toThrow("job failed");
  expect(release).toHaveBeenCalledOnce();
});

it("surfaces a failed lease release so a blocked runner is not silently considered healthy", async () => {
  release.mockRejectedValue(new Error("release failed"));
  await expect(withLease("tick", 120, async () => 1)).rejects.toThrow("release failed");
});
