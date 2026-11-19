import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, cleanDisplayName, onboardingMissing } from "../legal-rules";

describe("registration rules", () => {
  it("display names: letters, 2–40, no numbers or links", () => {
    expect(cleanDisplayName("  Солонго   Б. ")).toBe("Солонго Б.");
    expect(cleanDisplayName("Bat-Erdene G.")).toBe("Bat-Erdene G.");
    expect(cleanDisplayName("A")).toBeNull();
    expect(cleanDisplayName("Call 99112233")).toBeNull();
    expect(cleanDisplayName("www.x.mn")).toBeNull();
  });

  it("asks for what's missing, and again when a document version changes", () => {
    const done = { name: "Solongo B.", age_confirmed_at: "2026-11-19T00:00:00Z", terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy };
    expect(onboardingMissing(done)).toEqual([]);
    expect(onboardingMissing({ name: "", age_confirmed_at: null, terms_version: null, privacy_version: null })).toEqual(["name", "age", "terms", "privacy"]);
    expect(onboardingMissing({ ...done, terms_version: "2020-01-01" })).toEqual(["terms"]);
  });
});
