import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_DETAILS, EngineError, buyerFeeFor, counterMaxFor, errandSplit, isNight, minFeeAt, priceRange, quoteFee, serviceFeeFor, type ErrandDetails } from "../index";

describe("errandSplit", () => {
  it("matches the brief's example: carry, ₮40,000 fee, no items", () => {
    const s = errandSplit({ fee: 40000, itemBudget: 0, receipt: null, serviceFee: 1000, commissionBps: 1000 });
    expect(s).toEqual({
      spent: 0,
      commission: 4000,
      helperFeeNet: 36000,
      helperNet: 36000,
      refund: 0,
      platform: 5000,
      held: 41000,
    });
  });

  it("reimburses receipt and refunds the unspent budget", () => {
    const s = errandSplit({ fee: 9000, itemBudget: 38000, receipt: 35500, serviceFee: 1000, commissionBps: 1000 });
    expect(s.spent).toBe(35500);
    expect(s.helperNet).toBe(9000 - 900 + 35500);
    expect(s.refund).toBe(2500);
    expect(s.platform).toBe(1900);
    expect(s.held).toBe(48000);
  });

  it("caps reimbursement at the item budget (helper eats any overspend)", () => {
    const s = errandSplit({ fee: 9000, itemBudget: 38000, receipt: 41000, serviceFee: 1000, commissionBps: 1000 });
    expect(s.spent).toBe(38000);
    expect(s.refund).toBe(0);
  });

  it("always sums to the held amount (exhaustive grid)", () => {
    const fees = [5000, 5500, 7777, 10000, 40000, 123455, 1_000_000];
    const budgets = [0, 500, 38000, 99999, 500000];
    const bpsList = [0, 333, 1000, 1500, 2500];
    const service = [0, 1000, 1500];
    let checked = 0;
    for (const fee of fees)
      for (const itemBudget of budgets)
        for (const commissionBps of bpsList)
          for (const serviceFee of service)
            for (const receipt of [null, 0, Math.floor(itemBudget / 3), itemBudget, itemBudget + 1234]) {
              const s = errandSplit({ fee, itemBudget, receipt, serviceFee, commissionBps });
              expect(s.helperNet + s.refund + s.platform).toBe(s.held);
              expect(s.held).toBe(itemBudget + fee + serviceFee);
              for (const v of Object.values(s)) {
                expect(Number.isSafeInteger(v)).toBe(true);
                expect(v).toBeGreaterThanOrEqual(0);
              }
              checked++;
            }
    expect(checked).toBeGreaterThan(2000);
  });

  it("rejects non-integer or negative money", () => {
    expect(() => errandSplit({ fee: 5000.5, itemBudget: 0, receipt: null, serviceFee: 1000, commissionBps: 1000 })).toThrow(
      EngineError,
    );
    expect(() => errandSplit({ fee: 5000, itemBudget: -1, receipt: null, serviceFee: 1000, commissionBps: 1000 })).toThrow(
      EngineError,
    );
    expect(() => errandSplit({ fee: 5000, itemBudget: 0, receipt: NaN, serviceFee: 1000, commissionBps: 1000 })).toThrow(
      EngineError,
    );
  });
});

describe("flat service fee (docs/decisions.md 2026-11-15 Pricing)", () => {
  it("is a fixed amount by price step, never a percentage; SafePay uses the same steps", () => {
    // V1 spec C4 with the owner's split: 1,000₮ under 10,000₮ · 1,500₮ under 30,000₮ · 2,000₮ under 60,000₮ · 3,000₮ from 60,000₮ (job total)
    expect(serviceFeeFor(5000)).toBe(1000);
    expect(serviceFeeFor(9999)).toBe(1000);
    expect(serviceFeeFor(10000)).toBe(1500);
    expect(serviceFeeFor(29999)).toBe(1500);
    expect(serviceFeeFor(30000)).toBe(2000);
    expect(serviceFeeFor(59999)).toBe(2000);
    expect(serviceFeeFor(60000)).toBe(3000);
    expect(serviceFeeFor(100000)).toBe(3000);
    expect(buyerFeeFor(1_350_000)).toBe(3000);
    expect(DEFAULT_CONFIG.commissionBps).toBe(0); // helpers keep 100%
  });
});

describe("night", () => {
  const ub = (h: number, m = 0) => Date.UTC(2026, 10, 12, h - 8, m); // Ulaanbaatar wall time → UTC ms
  it("adds ₮1,000 from 22:00 to 06:59 Ulaanbaatar time: minimum ₮6,000 then, ₮5,000 otherwise", () => {
    expect(minFeeAt(ub(21, 59))).toBe(5000);
    expect(minFeeAt(ub(22, 0))).toBe(6000);
    expect(minFeeAt(ub(23, 30))).toBe(6000);
    expect(minFeeAt(ub(24 + 3))).toBe(6000);
    expect(minFeeAt(ub(24 + 6, 59))).toBe(6000);
    expect(minFeeAt(ub(24 + 7))).toBe(5000);
    expect(isNight(ub(12))).toBe(false);
    expect(quoteFee("deliver", DEFAULT_DETAILS, undefined, ub(23)).lines).toContainEqual({ key: "night", amount: 1000 });
    expect(quoteFee("deliver", DEFAULT_DETAILS, undefined, ub(23)).total).toBe(6000);
  });
});

describe("build-up price (quoteFee)", () => {
  const q = (category: Parameters<typeof quoteFee>[0], d: Partial<ErrandDetails>) => quoteFee(category, { ...DEFAULT_DETAILS, ...d });

  it("matches the worked examples agreed with the owner", () => {
    expect(q("shop", { km: 1 }).total).toBe(5000); // groceries 1 km, ~30 min
    expect(q("shop", { km: 3 }).total).toBe(8000); // + 2 km × 1,500
    expect(q("queue", { minutes: 120 }).total).toBe(14000); // + 3 × 3,000
    expect(q("repair", { minutes: 120, tools: true }).total).toBe(16000); // wardrobe: + 9,000 + 2,000
    // fridge to the 5th floor, no lift, 2 people, ~1 h: each 5,000 + 3,000 + 3,000 + 6,000
    const fridge = q("carry", { minutes: 60, heavy: true, floor: 5, lift: "no", people: 2 });
    expect(fridge.total).toBe(34000);
    expect(fridge.peopleRequired).toBe(2);
    expect(fridge.lines.map((l) => l.key)).toEqual(["base", "time", "heavy", "stairs", "secondPerson"]);
  });

  it("charges started half hours, ignores bad distances, never goes below the minimum", () => {
    expect(q("other", { minutes: 90 }).lines).toContainEqual({ key: "time", amount: 6000, qty: 60 });
    expect(q("queue", { km: -3 }).total).toBe(5000);
    expect(q("queue", { km: Number.NaN }).total).toBe(5000);
    expect(q("deliver", { km: 1.5 }).lines).toContainEqual({ key: "distance", amount: 1000, qty: 0.5 }); // 750 → 1,000
  });

  it("customer range and counter cap", () => {
    const day = Date.UTC(2026, 10, 12, 4);
    expect(priceRange(10000, day)).toEqual({ min: 8000, max: 13000 });
    expect(priceRange(5000, day)).toEqual({ min: 5000, max: 6500 }); // never below the minimum
    expect(priceRange(14000, day)).toEqual({ min: 11500, max: 18000 }); // 11,200 → up; 18,200 → down
    expect(counterMaxFor(10000)).toBe(13000);
    expect(counterMaxFor(5000)).toBe(6500);
  });
});
