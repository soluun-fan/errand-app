import { describe, expect, it } from "vitest";
import { ageBandLabel, ageBandOf, cleanTransport, parseExperience } from "@/lib/profile-rules";

const now = new Date("2026-11-26T00:00:00Z");

describe("helper profile extras (2026-11-26)", () => {
  it("age bands are decades, from the birth date as of today", () => {
    expect(ageBandOf("2008-11-25", now)).toBe(18); // 18 since yesterday
    expect(ageBandOf("2008-11-27", now)).toBeNull(); // still 17
    expect(ageBandOf("2006-01-01", now)).toBe(20);
    expect(ageBandOf("1990-12-01", now)).toBe(30); // 35, birthday not yet
    expect(ageBandOf("1950-01-01", now)).toBe(60);
    expect(ageBandOf("not a date", now)).toBeNull();
    expect([18, 30, 60].map(ageBandLabel)).toEqual(["18–19", "30–39", "60+"]);
  });

  it("transport keeps only known ways, in a fixed order", () => {
    expect(cleanTransport(["car", "rocket", "walk"])).toEqual(["walk", "car"]);
  });

  it("experience is whole years 0–60, or empty", () => {
    expect(parseExperience("")).toBeNull();
    expect(parseExperience(" 7 ")).toBe(7);
    expect(parseExperience("61")).toBe("invalid");
    expect(parseExperience("2.5")).toBe("invalid");
  });
});

describe("customer ID check before jobs in a home (2026-11-26)", () => {
  it("is needed for in-home and with-a-person kinds, only until the ID is checked, and never while review is off", async () => {
    const { needsIdCheck } = await import("@/lib/kyc-rules");
    expect(needsIdCheck("repair", 1, true)).toBe(true);
    expect(needsIdCheck("escort", 1, true)).toBe(true);
    expect(needsIdCheck("shop", 1, true)).toBe(false); // an errand outside the home
    expect(needsIdCheck("repair", 3, true)).toBe(false); // already checked
    expect(needsIdCheck("repair", 1, false)).toBe(false); // private test: ID review switched off
  });
});
