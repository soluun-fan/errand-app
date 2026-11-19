import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/turn", () => ({ turnCredentials: vi.fn() }));

import { callsEnabled, iceConfig } from "@/lib/calls";

beforeEach(() => {
  vi.stubEnv("CALLS_ENABLED", "false");
  vi.stubEnv("CLOUDFLARE_TURN_KEY_ID", "");
  vi.stubEnv("CLOUDFLARE_TURN_API_TOKEN", "");
  vi.stubEnv("TURN_URLS", "");
  vi.stubEnv("TURN_SECRET", "");
});

afterEach(() => vi.unstubAllEnvs());

it("keeps in-app calls disabled unless explicitly enabled", () => {
  expect(callsEnabled()).toBe(false);
  vi.stubEnv("CALLS_ENABLED", "true");
  expect(callsEnabled()).toBe(true);
});

it("does not return direct ICE servers when no TURN relay is configured", async () => {
  vi.stubEnv("CALLS_ENABLED", "true");
  await expect(iceConfig("user-1")).resolves.toEqual({ iceServers: [], relayOnly: false });
});
