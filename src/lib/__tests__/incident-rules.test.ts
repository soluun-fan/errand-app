import { describe, expect, it } from "vitest";
import { SOS_REPING_FOR_MS, SOS_REPING_MS, checkReport, cleanPosition, needsReping } from "@/lib/incident-rules";

describe("incident rules", () => {
  it("accepts a sane position and drops nonsense without failing", () => {
    expect(cleanPosition({ lat: 47.91, lng: 106.91, accuracy: 12.4 })).toEqual({ lat: 47.91, lng: 106.91, accuracy: 12 });
    expect(cleanPosition({ lat: 47.91, lng: 106.91 })).toEqual({ lat: 47.91, lng: 106.91, accuracy: null });
    expect(cleanPosition({ lat: 91, lng: 0 })).toBeNull();
    expect(cleanPosition({ lat: "47", lng: 106 })).toBeNull();
    expect(cleanPosition({ lat: Number.NaN, lng: 106 })).toBeNull();
    expect(cleanPosition(null)).toBeNull();
  });

  it("reports need a real kind (not sos) and a short description", () => {
    expect(checkReport("theft", "  He kept the change and left  ")).toEqual({ ok: true, kind: "theft", note: "He kept the change and left" });
    expect(checkReport("sos", "Please help me now")).toEqual({ ok: false, reason: "kind" });
    expect(checkReport("nope", "Please help me now")).toEqual({ ok: false, reason: "kind" });
    expect(checkReport("other", "short")).toEqual({ ok: false, reason: "note" });
    expect(checkReport("other", "x".repeat(1001))).toEqual({ ok: false, reason: "note" });
  });

  it("re-pings Ops about an unanswered SOS every 2 min for 30 min only", () => {
    const base = { kind: "sos", status: "open", createdAt: 0, lastPingAt: 0 };
    expect(needsReping(base, SOS_REPING_MS - 1)).toBe(false);
    expect(needsReping(base, SOS_REPING_MS)).toBe(true);
    expect(needsReping({ ...base, status: "acknowledged" }, SOS_REPING_MS)).toBe(false);
    expect(needsReping({ ...base, kind: "theft" }, SOS_REPING_MS)).toBe(false);
    expect(needsReping({ ...base, lastPingAt: SOS_REPING_FOR_MS }, SOS_REPING_FOR_MS + SOS_REPING_MS)).toBe(false);
  });
});
