import { afterEach, expect, it, vi } from "vitest";
import { runtimeVapidPublicKey } from "@/lib/vapid-env";

afterEach(() => vi.unstubAllEnvs());

it("reads the public key when asked, from either name, ignoring blanks", () => {
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
  vi.stubEnv("VAPID_PUBLIC_KEY", "");
  expect(runtimeVapidPublicKey()).toBeNull();
  vi.stubEnv("VAPID_PUBLIC_KEY", " BKey ");
  expect(runtimeVapidPublicKey()).toBe("BKey");
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "BPublic");
  expect(runtimeVapidPublicKey()).toBe("BPublic");
});
