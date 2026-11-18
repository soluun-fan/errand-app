import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, amountDue, createErrand, extraTaskFeeFor, serviceFeeFor, type EngineConfig, type ErrandDeal } from "../index";

/** More active tasks cost a little more (owner, 2026-11-18): free up to 3, then +500 each. */
const T0 = Date.UTC(2026, 10, 20, 4);
const post = (openTasks: number | undefined, cfg: EngineConfig = { ...DEFAULT_CONFIG, payMode: "direct" }) =>
  createErrand(
    { id: `X${openTasks}`, title: "t", description: "d", category: "shop", mode: "now", address: "a", itemBudget: 0, fee: 8000, customerId: "c1", openTasks },
    { now: T0, actor: { kind: "user", id: "c1", role: "customer" } },
    cfg,
  ).deal as ErrandDeal;

describe("extra fee beyond the free active tasks", () => {
  it("is 0 for the first 3, then 500 for each one more", () => {
    expect([0, 1, 2].map((n) => extraTaskFeeFor(n))).toEqual([0, 0, 0]);
    expect([3, 4, 9].map((n) => extraTaskFeeFor(n))).toEqual([500, 500, 500]);
    expect(extraTaskFeeFor(5, { ...DEFAULT_CONFIG, freeOpenTasks: 10 })).toBe(0); // Ops can change both
    expect(extraTaskFeeFor(3, { ...DEFAULT_CONFIG, extraTaskFee: 1000 })).toBe(1000);
  });

  it("is added to the service fee of the 4th task and shown in its details", () => {
    const base = serviceFeeFor(8000);
    expect(post(2).serviceFee).toBe(base);
    expect(post(2).details.extraFee).toBeUndefined();
    const fourth = post(3);
    expect(fourth.serviceFee).toBe(base + 500);
    expect(fourth.details.extraFee).toBe(500);
    expect(amountDue({ ...fourth, helperId: "h1" })).toBe(base + 500); // fee-only: what the customer pays through the app
    expect(post(undefined).serviceFee).toBe(base); // no count given (older callers): no extra
  });

  it("a client can't set it (it isn't a detail the form may send)", () => {
    const d = createErrand(
      { id: "Y", title: "t", description: "d", category: "shop", mode: "now", address: "a", itemBudget: 0, fee: 8000, customerId: "c1", details: { extraFee: -9999 } as never },
      { now: T0, actor: { kind: "user", id: "c1", role: "customer" } },
    ).deal as ErrandDeal;
    expect(d.details.extraFee).toBeUndefined();
    expect(d.serviceFee).toBe(serviceFeeFor(8000));
  });
});
