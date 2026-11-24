import { beforeEach, expect, it, vi } from "vitest";

const { getViewer, set, redirect } = vi.hoisted(() => ({ getViewer: vi.fn(), set: vi.fn(), redirect: vi.fn() }));
vi.mock("../auth", () => ({ getViewer }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
import { setMode } from "../prefs";

beforeEach(() => {
  vi.resetAllMocks();
  redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
});

it("does not store a mode without a signed-in account", async () => {
  getViewer.mockResolvedValue(null);
  await expect(setMode(new FormData())).rejects.toThrow("NEXT_REDIRECT");
  expect(redirect).toHaveBeenCalledWith("/login");
  expect(set).not.toHaveBeenCalled();
});

it.each(["helper", "customer"])("binds %s to the verified viewer, ignoring submitted user IDs", async (mode) => {
  getViewer.mockResolvedValue({ profile: { id: "account-a" } });
  const form = new FormData();
  form.set("mode", mode);
  form.set("userId", "account-b");
  await expect(setMode(form)).rejects.toThrow("NEXT_REDIRECT");
  expect(set).toHaveBeenCalledWith("mode", `account-a:${mode}`, expect.objectContaining({ path: "/", httpOnly: true, sameSite: "lax" }));
  expect(redirect).toHaveBeenCalledWith(mode === "helper" ? "/jobs" : "/");
});
