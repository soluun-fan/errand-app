import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, EngineError, buyerFeeFor, errandSplit, suggestFee } from "../index";

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

describe("buyerFeeFor", () => {
  it("is 1% with a ₮1,000 floor", () => {
    expect(buyerFeeFor(50000)).toBe(1000);
    expect(buyerFeeFor(100000)).toBe(1000);
    expect(buyerFeeFor(1_350_000)).toBe(13500);
    expect(buyerFeeFor(1_350_050)).toBe(13501); // rounds half up
  });
});

describe("suggestFee", () => {
  it("is category base + distance, rounded to ₮500, never below the minimum", () => {
    expect(suggestFee("shop", 1.5)).toBe(8500); // 6000 + 2250 = 8250 → 8500
    expect(suggestFee("carry", 0)).toBe(15000);
    expect(suggestFee("deliver", 0)).toBe(DEFAULT_CONFIG.minFee);
    expect(suggestFee("queue", -3)).toBe(8000);
    expect(suggestFee("queue", Number.NaN)).toBe(8000);
  });
});
