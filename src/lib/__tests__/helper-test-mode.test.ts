import { afterEach, describe, expect, it, vi } from "vitest";

describe("unverified helper test mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is disabled by default and enables any authenticated tester when explicitly enabled", async () => {
    vi.stubEnv("UNVERIFIED_HELPERS_TEST_MODE", "false");
    vi.resetModules();
    let mode = await import("../helper-test-mode");
    expect(mode.canUseUnverifiedHelperTest()).toBe(false);
    expect(mode.isActiveTestHelper({ test_helper: true })).toBe(false);

    vi.stubEnv("UNVERIFIED_HELPERS_TEST_MODE", "true");
    vi.resetModules();
    mode = await import("../helper-test-mode");
    expect(mode.canUseUnverifiedHelperTest()).toBe(true);
    expect(mode.isActiveTestHelper({ test_helper: true })).toBe(true);
    expect(mode.isActiveTestHelper({ test_helper: false })).toBe(false);
  });
});
