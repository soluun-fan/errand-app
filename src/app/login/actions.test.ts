import { beforeEach, expect, it, vi } from "vitest";

const { redirect, checkVerifyMnLogin, createAdminClient, createClient, deleteCookie, clearPendingLogin } = vi.hoisted(() => ({
  createClient: vi.fn(),
  deleteCookie: vi.fn(),
  clearPendingLogin: vi.fn(),
  redirect: vi.fn(),
  checkVerifyMnLogin: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: deleteCookie }) }));
vi.mock("@/i18n/server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/lib/dev", () => ({ loginRules: () => ({ allowed: false, showCode: false }) }));
vi.mock("@/lib/next-path", () => ({ safeNext: () => "/" }));
vi.mock("@/lib/legal-rules", () => ({ onboardingMissing: () => [] }));
vi.mock("@/lib/phone", () => ({ normalizeMnPhone: (phone: string) => phone }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/verify-mn-login", () => ({
  checkVerifyMnLogin,
  clearPendingLogin,
  pendingLogin: vi.fn(async () => null),
  startVerifyMnLogin: vi.fn(),
  verifyMnLoginEnabled: () => true,
}));

import { login, signOut } from "./actions";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERIFY_MN_API_KEY", "test-key");
  createAdminClient.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { name: "Tester", age_confirmed_at: "2026-01-01", terms_version: "v1", privacy_version: "v1" } }),
        }),
      }),
    }),
  });
  checkVerifyMnLogin.mockResolvedValue({ status: "verified", userId: "user-1" });
  redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

it("lets the successful login redirect escape the provider-status error handler", async () => {
  const form = new FormData();
  form.set("next", "/");
  await expect(login({ step: "verify-mn", view: {
    phone: "+97688000001",
    sessionId: "session-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    smsUri: "sms:144773?body=123456",
    displayInstruction: "Send 123456",
  } }, form)).rejects.toThrow("NEXT_REDIRECT");
  expect(redirect).toHaveBeenCalledWith("/");
});

it("clears account mode and pending login on sign-out", async () => {
  const authSignOut = vi.fn().mockResolvedValue({ error: null });
  createClient.mockResolvedValue({ auth: { signOut: authSignOut } });
  await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");
  expect(authSignOut).toHaveBeenCalledOnce();
  expect(deleteCookie).toHaveBeenCalledWith("mode");
  expect(clearPendingLogin).toHaveBeenCalledOnce();
  expect(redirect).toHaveBeenCalledWith("/login");
});
