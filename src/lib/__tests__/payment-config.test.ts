import { afterEach, expect, it, vi } from "vitest";
import { paymentConfiguration } from "../payments/config";
import { mockPaymentsEnabled, mockProvider } from "../payments/provider";

afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "", "mock", "unknown"])("disables production payments for provider %s", (provider) => {
  expect(paymentConfiguration({ NODE_ENV: "production", PAYMENT_PROVIDER: provider }).provider).toBe("disabled");
});

it("requires both Wire credentials and never falls back to mock", () => {
  expect(paymentConfiguration({ PAYMENT_PROVIDER: "wire" }, true)).toMatchObject({
    provider: "disabled",
    errors: ["WIRE_SECRET_KEY is required when PAYMENT_PROVIDER=wire", "WIRE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=wire"],
  });
  expect(paymentConfiguration({ PAYMENT_PROVIDER: "wire", WIRE_SECRET_KEY: "test", WIRE_WEBHOOK_SECRET: "test" }, true).provider).toBe(
    "wire",
  );
});

it("permits explicitly configured staging mocks, but never on Vercel Production", () => {
  const env = { NODE_ENV: "production", APP_ENV: "staging", PAYMENT_PROVIDER: "mock" };
  expect(paymentConfiguration(env, true).provider).toBe("mock");
  expect(paymentConfiguration({ ...env, VERCEL_ENV: "production" }).provider).toBe("disabled");
  expect(paymentConfiguration({ ...env, APP_ENV: "stagng" }).provider).toBe("disabled");
});

it("uses mock only as a local default; deployment validation requires an explicit choice", () => {
  expect(paymentConfiguration({ NODE_ENV: "development" }).provider).toBe("mock");
  expect(paymentConfiguration({ NODE_ENV: "development" }, true).provider).toBe("disabled");
});

it("refuses simulated invoice creation in production even when called directly", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("PAYMENT_PROVIDER", "mock");
  expect(mockPaymentsEnabled()).toBe(false);
  await expect(mockProvider.createInvoice("task", 12000)).rejects.toThrow("disabled");
});
