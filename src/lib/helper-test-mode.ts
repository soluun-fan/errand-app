export const unverifiedHelpersTestMode = process.env.UNVERIFIED_HELPERS_TEST_MODE === "true";

export function canUseUnverifiedHelperTest(): boolean {
  return unverifiedHelpersTestMode;
}

export function isActiveTestHelper(profile: { test_helper?: boolean }): boolean {
  return unverifiedHelpersTestMode && profile.test_helper === true;
}
