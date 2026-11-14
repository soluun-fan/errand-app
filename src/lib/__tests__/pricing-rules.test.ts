import { describe, expect, it } from "vitest";
import { cleanTiers, percentToBps, wholeAmount } from "@/lib/pricing-rules";

describe("pricing settings checks", () => {
  it("accepts ascending service-fee steps that end open-ended", () => {
    const ok = [
      { below: 10000, fee: 500 },
      { below: 30000, fee: 1000 },
      { below: null, fee: 3000 },
    ];
    expect(cleanTiers(ok)).toEqual(ok);
    expect(cleanTiers([{ below: null, fee: 0 }])).toEqual([{ below: null, fee: 0 }]);
  });

  it("refuses steps out of order, a closed last step, odd fees or junk", () => {
    expect(cleanTiers([{ below: 30000, fee: 1000 }, { below: 10000, fee: 500 }, { below: null, fee: 3000 }])).toBeNull();
    expect(cleanTiers([{ below: 10000, fee: 500 }])).toBeNull();
    expect(cleanTiers([{ below: 10000, fee: 500.5 }, { below: null, fee: 1000 }])).toBeNull();
    expect(cleanTiers([{ below: null, fee: -1 }])).toBeNull();
    expect(cleanTiers([])).toBeNull();
    expect(cleanTiers("x")).toBeNull();
    expect(cleanTiers([null])).toBeNull();
  });

  it("reads whole amounts and percentages from form fields", () => {
    expect(wholeAmount("5,000₮", 0, 100000)).toBe(5000);
    expect(wholeAmount("5000.5", 0, 100000)).toBeNull();
    expect(wholeAmount("", 1, 100000)).toBeNull();
    expect(wholeAmount("200000", 0, 100000)).toBeNull();
    expect(percentToBps("20", 50)).toBe(2000);
    expect(percentToBps("60", 50)).toBeNull();
  });
});
