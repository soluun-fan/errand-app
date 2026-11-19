import { describe, expect, it } from "vitest";
import { googleAuthEmails, googleAuthEnabled, isGoogleEmailAllowed } from "@/lib/google-auth-policy";

describe("Google sign-in allowlist", () => {
  it("normalizes and deduplicates configured emails", () => {
    expect(googleAuthEmails(" Owner@Example.com, owner@example.com, test@example.com "))
      .toEqual(["owner@example.com", "test@example.com"]);
  });

  it("keeps Google sign-in disabled without an allowlist", () => {
    expect(googleAuthEnabled(undefined)).toBe(false);
    expect(googleAuthEnabled(" ,  ")).toBe(false);
    expect(isGoogleEmailAllowed("owner@example.com", undefined)).toBe(false);
  });

  it("matches an allowlisted email case-insensitively and rejects others", () => {
    expect(isGoogleEmailAllowed("OWNER@example.com", "owner@example.com, test@example.com")).toBe(true);
    expect(isGoogleEmailAllowed("other@example.com", "owner@example.com, test@example.com")).toBe(false);
    expect(isGoogleEmailAllowed(undefined, "owner@example.com")).toBe(false);
  });
});
