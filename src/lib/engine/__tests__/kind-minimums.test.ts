import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_DETAILS, apply, createErrand, lowestMinFee, quoteFee, taskMinFee, type CategoryId, type EngineConfig, type ErrandDeal } from "../index";

/** Minimums per kind (owner, 2026-11-17): rubbish cheaper than shopping, hard labour higher, day jobs by the hour, the trip on top. */
const cfg: EngineConfig = {
  ...DEFAULT_CONFIG,
  kindMinFee: { trash: 3000, carry: 10000, assembly: 8000, plumbing: 15000 },
  kindMinHourly: { dayjob: 6000, childcare: 8000 },
};
const NOON = Date.UTC(2026, 10, 20, 4); // 12:00 in Ulaanbaatar
const NIGHT = Date.UTC(2026, 10, 20, 15); // 23:00 in Ulaanbaatar
const d = (x: Partial<typeof DEFAULT_DETAILS> = {}) => ({ ...DEFAULT_DETAILS, ...x });

describe("each kind has its own floor", () => {
  it("rubbish is cheaper than shopping, carrying costs more", () => {
    expect(taskMinFee("trash", d(), NOON, cfg)).toBe(3000);
    expect(taskMinFee("shop", d(), NOON, cfg)).toBe(5000); // no own minimum: the general one
    expect(taskMinFee("carry", d(), NOON, cfg)).toBe(10000);
    expect(taskMinFee("carry", d({ people: 2 }), NOON, cfg)).toBe(20000); // two people: twice the labour
  });

  it("hourly kinds: the hourly floor × hours", () => {
    expect(taskMinFee("dayjob", d({ minutes: 240 }), NOON, cfg)).toBe(24000);
    expect(taskMinFee("dayjob", d({ minutes: 90 }), NOON, cfg)).toBe(9000);
    expect(taskMinFee("childcare", d({ minutes: 180 }), NOON, cfg)).toBe(24000);
  });

  it("the trip and the night extra come on top", () => {
    expect(taskMinFee("shop", d({ km: 4 }), NOON, cfg)).toBe(5000 + 4500); // 3 km beyond the first
    expect(taskMinFee("shop", d({ km: 4, roundTrip: true }), NOON, cfg)).toBe(5000 + 4500 + 3000);
    expect(taskMinFee("trash", d(), NIGHT, cfg)).toBe(3000 + cfg.nightFee);
  });

  it("our suggestion is never below the floor; 'from' shows the cheapest fixed floor", () => {
    expect(quoteFee("carry", d(), cfg, NOON).total).toBeGreaterThanOrEqual(10000);
    expect(quoteFee("dayjob", d({ minutes: 480 }), cfg, NOON).total).toBeGreaterThanOrEqual(48000);
    expect(lowestMinFee(["shop", "trash", "carry", "dayjob"] as CategoryId[], cfg)).toBe(3000);
  });
});

describe("posting and bargaining use the task's own floor", () => {
  const post = (category: CategoryId, fee: number, extra: Partial<typeof DEFAULT_DETAILS> = {}) =>
    createErrand(
      { id: `T-${category}-${fee}`, title: "t", description: "d", category, mode: "now", address: "a", itemBudget: 0, fee, customerId: "c1", details: d(extra) },
      { now: NOON, actor: { kind: "user", id: "c1", role: "customer" } },
      cfg,
    ).deal;

  it("refuses below the floor and remembers it on the task", () => {
    expect(() => post("carry", 9500)).toThrow("Minimum fee is ₮10000");
    expect(post("trash", 3000).details.minFee).toBe(3000);
    expect(() => post("dayjob", 20000, { minutes: 240 })).toThrow("Minimum fee is ₮24000");
  });

  it("a helper's counter-price is checked against the task's saved floor", () => {
    const task = post("carry", 12000) as ErrandDeal;
    const helper = { kind: "user" as const, id: "h1", role: "helper" as const, helperApproved: true, categories: ["carry" as CategoryId] };
    expect(() => apply(task, { type: "apply", note: "", price: 9000 }, { now: NOON + 60_000, actor: helper })).toThrow("Minimum fee is ₮10000");
    expect(apply(task, { type: "apply", note: "", price: 11000 }, { now: NOON + 60_000, actor: helper }).deal.status).toBe("open");
  });
});
