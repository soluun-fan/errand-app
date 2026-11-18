import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, cleanDisplayName, isAdultOn, onboardingMissing } from "../legal-rules";

describe("registration rules", () => {
  it("18 or older on the day, real dates only", () => {
    expect(isAdultOn("2008-11-18", "2026-11-18")).toBe(true); // 18th birthday
    expect(isAdultOn("2008-11-19", "2026-11-18")).toBe(false); // one day short
    expect(isAdultOn("1990-02-31", "2026-11-18")).toBe(false); // no such date
    expect(isAdultOn("1899-01-01", "2026-11-18")).toBe(false);
    expect(isAdultOn("2030-01-01", "2026-11-18")).toBe(false);
    expect(isAdultOn("18-11-2000", "2026-11-18")).toBe(false);
  });

  it("display names: letters, 2–40, no numbers or links", () => {
    expect(cleanDisplayName("  Солонго   Б. ")).toBe("Солонго Б.");
    expect(cleanDisplayName("Bat-Erdene G.")).toBe("Bat-Erdene G.");
    expect(cleanDisplayName("A")).toBeNull();
    expect(cleanDisplayName("Call 99112233")).toBeNull();
    expect(cleanDisplayName("www.x.mn")).toBeNull();
  });

  it("asks for what's missing, and again when a document version changes", () => {
    const done = { name: "Solongo B.", birth_date: "1995-01-01", terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy };
    expect(onboardingMissing(done)).toEqual([]);
    expect(onboardingMissing({ name: "", birth_date: null, terms_version: null, privacy_version: null })).toEqual(["name", "birth", "terms", "privacy"]);
    expect(onboardingMissing({ ...done, terms_version: "2020-01-01" })).toEqual(["terms"]);
  });
});
