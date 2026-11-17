import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_DETAILS, EngineError, careTimeOk, createErrand, quoteFee, suggestedMinutes, type CategoryId } from "../index";

/** Care pilot + trip time (docs/decisions.md 2026-11-17 "Care pilot"). */
const ub = (hour: number, minute = 0) => Date.UTC(2026, 10, 20, hour - 8, minute); // a time of day in Ulaanbaatar (UTC+8)

describe("“About how long?” follows the trip", () => {
  it("adds travel time per leg at 3 min/km, in 30-minute steps", () => {
    expect(suggestedMinutes(30, 0, false)).toBe(30);
    expect(suggestedMinutes(30, 4, false)).toBe(60); // 30 + 12 → 60
    expect(suggestedMinutes(30, 10, false)).toBe(60); // 30 + 30
    expect(suggestedMinutes(30, 10, true)).toBe(90); // 30 + 60 there and back
    expect(suggestedMinutes(120, 100, true)).toBe(480); // never over 8 hours
    expect(suggestedMinutes(30, 10, true, { ...DEFAULT_CONFIG, travelMinPerKm: 0 })).toBe(30); // Ops can switch it off
  });

  it("a longer trip costs more time as well as distance", () => {
    const oneWay = quoteFee("deliver", { ...DEFAULT_DETAILS, km: 10, minutes: suggestedMinutes(30, 10, false) });
    const back = quoteFee("deliver", { ...DEFAULT_DETAILS, km: 10, roundTrip: true, minutes: suggestedMinutes(30, 10, true) });
    expect(back.lines.map((l) => l.key)).toEqual(expect.arrayContaining(["distance", "roundTrip", "time"]));
    expect(back.total).toBeGreaterThan(oneWay.total);
  });
});

describe("care work: daytime only, up to 6 hours", () => {
  it("checks the window in Ulaanbaatar time", () => {
    expect(careTimeOk(ub(8), 360)).toBe(true);
    expect(careTimeOk(ub(15), 360)).toBe(true); // ends 21:00
    expect(careTimeOk(ub(15, 30), 360)).toBe(false); // ends 21:30
    expect(careTimeOk(ub(7, 30), 60)).toBe(false);
    expect(careTimeOk(ub(10), 390)).toBe(false); // over 6 hours
    expect(careTimeOk(ub(22), 30)).toBe(false);
  });

  const post = (category: CategoryId, at: number, minutes: number) =>
    createErrand(
      { id: "c1-care", title: "Watch my son", description: "x", category, mode: "now", scheduledAt: at, address: "a", itemBudget: 0, fee: 20_000, customerId: "c1", details: { ...DEFAULT_DETAILS, minutes } },
      { now: at - 3_600_000, actor: { kind: "user", id: "c1", role: "customer" } },
    );

  it("refuses a babysitting or elder-care task at night or longer than 6 hours", () => {
    expect(post("childcare", ub(10), 360).deal.status).toBe("open");
    for (const [cat, at, min] of [["childcare", ub(20), 120], ["eldercare", ub(10), 420], ["childcare", ub(6), 60]] as const) {
      expect(() => post(cat, at, min)).toThrow(EngineError);
      expect(() => post(cat, at, min)).toThrow(/daytime only/);
    }
  });

  it("other kinds of work are not limited", () => {
    expect(post("cleaning", ub(20), 240).deal.status).toBe("open");
  });
});
