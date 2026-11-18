import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, createErrand, kindFromLabel, suggestedPrice, type EngineConfig } from "../index";

/** Owner's V1 Master Spec (2026-11-18), Part C: suggested price, job-total cap, fee on the job total, payment windows. */
const now = Date.UTC(2026, 10, 18, 3); // 11:00 Ulaanbaatar
const customer = { kind: "user", id: "c1", role: "customer" } as const;
const post = (fee: number, itemBudget = 0, extra: Partial<Parameters<typeof createErrand>[0]> = {}, cfg: EngineConfig = DEFAULT_CONFIG) =>
  createErrand({ id: crypto.randomUUID(), title: "Buy bread", description: "x", category: "shop", mode: "now", address: "Test", customerId: "c1", fee, itemBudget, ...extra }, { now, actor: customer }, cfg);

describe("managed service pricing", () => {
  it("suggests the minimum × 1.25, rounded up to the price step", () => {
    expect(suggestedPrice(5000)).toBe(6500); // 6,250 → 6,500
    expect(suggestedPrice(8000)).toBe(10000);
    expect(suggestedPrice(5000, { ...DEFAULT_CONFIG, suggestBps: 10_000 })).toBe(5000);
  });

  it("the service & safety fee is on the job total (price + shopping budget)", () => {
    expect(post(8000).deal.serviceFee).toBe(1000);
    expect(post(8000, 5000).deal.serviceFee).toBe(1500); // 13,000 job total
    expect(post(20000, 45000).deal.serviceFee).toBe(3000); // 65,000
  });

  it("a job total over the cap is refused, and later prices are held to the cap saved at posting", () => {
    expect(() => post(150_000, 60_000)).toThrow(/Job total is over ₮200000/);
    const t = post(190_000);
    expect(t.deal.details.maxTotal).toBe(200_000);
  });

  it("booked and not-urgent tasks get 30 minutes to pay; 'now' tasks 10", () => {
    expect(post(8000).deal.details.rules?.paymentWindowMinutes).toBe(10);
    expect(post(8000, 0, { mode: "schedule", scheduledAt: now + 86_400_000 }).deal.details.rules?.paymentWindowMinutes).toBe(30);
    expect(post(8000, 0, { mode: "schedule" }).deal.details.rules?.paymentWindowMinutes).toBe(30);
  });

  it("day jobs are advertised per job, never per hour; care keeps its hourly label", () => {
    const cfg = { ...DEFAULT_CONFIG, kindMinHourly: { dayjob: 4000, childcare: 8000 } };
    expect(kindFromLabel("dayjob", cfg).hourly).toBe(false);
    expect(kindFromLabel("dayjob", cfg).amount % 4000).toBe(0);
    expect(kindFromLabel("childcare", cfg)).toEqual({ amount: 8000, hourly: true });
  });
});
