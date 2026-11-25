import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { PAUSE_DAYS, isPaused } from "../safety";

describe("isPaused (Ops pause / standards pause)", () => {
  const now = Date.UTC(2026, 10, 25, 12);
  it("is paused only while suspended_until is in the future", () => {
    expect(isPaused({ suspended_until: null }, now)).toBe(false);
    expect(isPaused({ suspended_until: new Date(now + 60_000).toISOString() }, now)).toBe(true);
    expect(isPaused({ suspended_until: new Date(now - 60_000).toISOString() }, now)).toBe(false);
  });
  it("offers a short and a long pause", () => expect(PAUSE_DAYS).toEqual([7, 30]));
});
