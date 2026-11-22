import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { withLease, heartbeat, runTick } = vi.hoisted(() => ({
  withLease: vi.fn(), heartbeat: vi.fn(), runTick: vi.fn(),
}));
vi.mock("@/lib/scheduler", () => ({ withLease, heartbeat }));
vi.mock("@/lib/tick", () => ({ runTick }));
import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "a".repeat(32));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("rejects invalid credentials, including equal-character-count multibyte input, without running a job", async () => {
  for (const value of ["", "Bearer bad", `Bearer ${"é".repeat(32)}`, `Bearer ${"b".repeat(32)}`]) {
    const response = await GET(new Request("http://localhost/api/cron/tick", { headers: { authorization: value } }));
    expect(response.status).toBe(401);
  }
  expect(withLease).not.toHaveBeenCalled();
  expect(runTick).not.toHaveBeenCalled();
});

it("fails the scheduled request if its successful run cannot be recorded", async () => {
  withLease.mockResolvedValue({ ran: true, result: { settled: 0 } });
  heartbeat.mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValueOnce(undefined);
  const response = await GET(new Request("http://localhost/api/cron/tick", { headers: { authorization: `Bearer ${"a".repeat(32)}` } }));
  expect(response.status).toBe(500);
  expect(heartbeat).toHaveBeenLastCalledWith("tick", { ok: false, error: "database unavailable" });
});

it("does not claim a new successful heartbeat when another tick holds the lease", async () => {
  withLease.mockResolvedValue({ ran: false });
  const response = await GET(new Request("http://localhost/api/cron/tick", { headers: { authorization: `Bearer ${"a".repeat(32)}` } }));
  expect(await response.json()).toEqual({ skipped: "another tick is running" });
  expect(heartbeat).not.toHaveBeenCalled();
});

it("records a missing server secret as a scheduler failure instead of a silent 401", async () => {
  vi.stubEnv("CRON_SECRET", "");
  heartbeat.mockResolvedValue(undefined);
  const response = await GET(new Request("http://localhost/api/cron/tick", { headers: { authorization: "Bearer anything" } }));
  expect(response.status).toBe(503);
  expect(heartbeat).toHaveBeenCalledWith("tick", { ok: false, error: "CRON_SECRET is not set on the server" });
  expect(runTick).not.toHaveBeenCalled();
});
