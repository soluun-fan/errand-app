import { describe, expect, it } from "vitest";
import { tickHealth } from "@/lib/health-rules";

const NOW = Date.UTC(2026, 10, 16, 4);
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

describe("scheduler health", () => {
  it("ok while the tick ran in the last 2 minutes without error", () => {
    expect(tickHealth({ last_run_at: ago(15), last_ok_at: ago(15), last_error: null }, NOW)).toEqual({ state: "ok", agoMs: 15_000 });
  });
  it("stopped after 2 minutes of silence, never when it has not run at all", () => {
    expect(tickHealth({ last_run_at: ago(180), last_ok_at: ago(180), last_error: null }, NOW).state).toBe("stopped");
    expect(tickHealth(null, NOW).state).toBe("never");
  });
  it("failing when the last run errored (even if runs keep coming)", () => {
    expect(tickHealth({ last_run_at: ago(10), last_ok_at: ago(400), last_error: "db down" }, NOW)).toEqual({ state: "failing", agoMs: 10_000, error: "db down" });
  });
});
