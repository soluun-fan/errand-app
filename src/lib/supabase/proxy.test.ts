import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { state } = vi.hoisted(() => ({ state: { userId: null as string | null, refresh: false } }));
vi.mock("./env", () => ({ supabaseUrl: () => "https://test.supabase.co", supabasePublishableKey: () => "test-key" }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: unknown[], headers: Record<string, string>) => void } }) => ({
    auth: { getClaims: async () => {
      if (state.refresh) options.cookies.setAll([{ name: "session", value: "refreshed", options: { httpOnly: true } }], { "Cache-Control": "private, no-store", Expires: "0", Pragma: "no-cache" });
      return { data: { claims: { sub: state.userId } } };
    } },
  }),
}));
import { updateSession } from "./proxy";

beforeEach(() => { state.userId = "account-b"; state.refresh = false; });

it.each(["helper", "account-a:helper"])("does not redirect a different account with cookie %s", async (value) => {
  const request = new NextRequest("https://app.test/");
  request.cookies.set("mode", value);
  const response = await updateSession(request);
  expect(response.headers.get("location")).toBeNull();
});

it("redirects a worker home while preserving refreshed session and cache headers", async () => {
  state.refresh = true;
  const request = new NextRequest("https://app.test/");
  request.cookies.set("mode", "account-b:helper");
  const response = await updateSession(request);
  expect(response.headers.get("location")).toBe("https://app.test/jobs");
  expect(response.cookies.get("session")?.value).toBe("refreshed");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
});

it("preserves a deep link and session headers when login is required", async () => {
  state.userId = null;
  state.refresh = true;
  const response = await updateSession(new NextRequest("https://app.test/tasks/example?view=history"));
  expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe("/tasks/example?view=history");
  expect(response.cookies.get("session")?.value).toBe("refreshed");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
});
