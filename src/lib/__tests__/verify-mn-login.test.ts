import { beforeEach, afterEach, expect, it, vi } from "vitest";

const { jar, createSession, getSession, issue, redeem, outbox } = vi.hoisted(() => ({
  jar: new Map<string, string>(), createSession: vi.fn(), getSession: vi.fn(),
  issue: vi.fn(), redeem: vi.fn(), outbox: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({
  set: (key: string, value: string, options?: { maxAge?: number }) => options?.maxAge === 0 ? jar.delete(key) : jar.set(key, value),
  get: (key: string) => ({ value: jar.get(key) }),
}) }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => ({ rpc: outbox }) }));
vi.mock("../supabase/server", () => ({ createClient: () => ({ auth: { signInWithOtp: issue, verifyOtp: redeem } }) }));
vi.mock("../verify-mn", () => ({ createVerifyMnClient: () => ({ createSession, getSession }) }));
vi.mock("../error-log", () => ({ recordError: async () => undefined }));

import { checkVerifyMnLogin, pendingLogin, startVerifyMnLogin } from "../verify-mn-login";

const phone = "+97688112233";
beforeEach(() => {
  jar.clear();
  vi.resetAllMocks();
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
  issue.mockResolvedValue({ error: null });
  outbox.mockResolvedValue({ data: "642198" });
  redeem.mockResolvedValue({ data: { user: { id: "user-id" }, session: { access_token: "access" } } });
  createSession.mockImplementation(async (_phone, text) => ({
    sessionId: "session", smsUri: "sms:144773?body=" + text,
    displayInstruction: "Send " + text, expiresAt: new Date(Date.now() + 300000).toISOString(),
  }));
});
afterEach(() => vi.unstubAllEnvs());

it("signs in only the phone bound to this browser after provider confirmation", async () => {
  const view = await startVerifyMnLogin(phone);
  expect(await pendingLogin()).toEqual(view);
  expect(JSON.stringify(view)).not.toContain("642198");
  expect(createSession.mock.calls[0][0]).toBe(phone);
  expect(await startVerifyMnLogin(phone)).toEqual(view);
  expect(issue).toHaveBeenCalledTimes(1);
  expect(await checkVerifyMnLogin("another-session")).toEqual({ status: "expired" });
  expect(getSession).not.toHaveBeenCalled();
  const expiresAt = new Date(Date.now() + 300000).toISOString();
  getSession.mockResolvedValueOnce({ sessionStatus: "PENDING", expiresAt });
  expect(await checkVerifyMnLogin("session")).toMatchObject({ status: "pending" });
  expect(redeem).not.toHaveBeenCalled();
  getSession.mockResolvedValueOnce({ sessionStatus: "VERIFIED", expiresAt });
  expect(await checkVerifyMnLogin("session")).toEqual({ status: "verified", userId: "user-id" });
  expect(redeem).toHaveBeenCalledWith({ phone, token: "642198", type: "sms" });
  expect(await checkVerifyMnLogin("session")).toEqual({ status: "expired" });
  expect(redeem).toHaveBeenCalledTimes(1);
});

it("rejects an altered browser challenge and a provider-expired session", async () => {
  await startVerifyMnLogin(phone);
  const [key, original] = [...jar][0];
  jar.set(key, (original[0] === "a" ? "b" : "a") + original.slice(1));
  expect(await checkVerifyMnLogin("session")).toMatchObject({ status: "expired" });
  expect(getSession).not.toHaveBeenCalled();
  jar.set(key, original);
  getSession.mockResolvedValueOnce({ sessionStatus: "EXPIRED", expiresAt: new Date().toISOString() });
  expect(await checkVerifyMnLogin("session")).toMatchObject({ status: "expired" });
  expect(redeem).not.toHaveBeenCalled();
});

it("does not start a paid-phone flow when Supabase fails to issue a credential", async () => {
  outbox.mockResolvedValueOnce({ error: true });
  expect(await startVerifyMnLogin(phone)).toBeNull();
  expect(createSession).not.toHaveBeenCalled();
});

it("keeps the verified challenge when Supabase cannot finish sign-in", async () => {
  await startVerifyMnLogin(phone);
  getSession.mockResolvedValue({ sessionStatus: "VERIFIED", expiresAt: new Date(Date.now() + 300000).toISOString() });
  redeem.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "verification failed" } });

  expect(await checkVerifyMnLogin("session")).toEqual({ status: "auth-failed" });
  expect(await pendingLogin()).not.toBeNull();
  expect(redeem).toHaveBeenCalledTimes(1);
});

it("after Verify.MN confirms, an expired private code is replaced by a fresh one and the person is signed in", async () => {
  await startVerifyMnLogin(phone);
  getSession.mockResolvedValue({ sessionStatus: "VERIFIED", expiresAt: new Date(Date.now() + 300000).toISOString() });
  redeem
    .mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "Token has expired or is invalid" } })
    .mockResolvedValueOnce({ data: { user: { id: "user-id" }, session: { access_token: "access" } }, error: null });
  outbox.mockResolvedValueOnce({ data: "777111" }); // the fresh code the hook stored

  expect(await checkVerifyMnLogin("session")).toEqual({ status: "verified", userId: "user-id" });
  expect(issue).toHaveBeenCalledTimes(2); // the original, and the fresh one
  expect(redeem).toHaveBeenLastCalledWith({ phone, token: "777111", type: "sms" });
});
