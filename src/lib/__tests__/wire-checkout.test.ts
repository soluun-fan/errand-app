import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { chargeOf, createCheckout, createIntent, getIntent, refundCharge } from "@/lib/payments/wire";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses the Wire checkout, payment lookup, and refund API with amounts in whole MNT", async () => {
  vi.stubEnv("WIRE_SECRET_KEY", "local-test-key");
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ id: "pi_local", status: "requires_payment_method", amount: 12000, currency: "MNT" }))
    .mockResolvedValueOnce(Response.json({ id: "cs_local", url: "https://pay.wire.mn/c/example" }))
    .mockResolvedValueOnce(Response.json({ id: "pi_local", status: "succeeded", amount: 12000, currency: "MNT", charge: "ch_local" }))
    .mockResolvedValueOnce(Response.json({ id: "re_local", status: "pending", amount: 12000 }));
  vi.stubGlobal("fetch", fetch);
  const back = "https://shop.example/tasks/local";
  const intent = await createIntent(12000, "Delivery", { deal_id: "local" }, "intent-local");
  expect((await createCheckout(intent.id, back, back, "checkout-local")).url).toBe("https://pay.wire.mn/c/example");
  const paid = await getIntent(intent.id);
  const charge = chargeOf(paid);
  expect(charge).toBe("ch_local");
  await refundCharge(charge!, paid.amount, "task refund", "refund-local");
  const requests = fetch.mock.calls.map(([url, options]) => ({
    url, method: options?.method, headers: new Headers(options?.headers),
    body: options?.body ? JSON.parse(String(options.body)) : undefined,
  }));
  expect(requests.map(r => [r.method,r.url])).toEqual([
    ["POST", "https://api.wire.mn/v1/payment_intents"],
    ["POST", "https://api.wire.mn/v1/checkout/sessions"],
    ["GET", "https://api.wire.mn/v1/payment_intents/pi_local"],
    ["POST", "https://api.wire.mn/v1/refunds"],
  ]);
  expect(requests.every(r => r.headers.get("Authorization") === "Bearer local-test-key")).toBe(true);
  expect(requests.map(r => r.headers.get("Idempotency-Key"))).toEqual(["intent-local","checkout-local",null,"refund-local"]);
  expect(requests[0].body).toMatchObject({ amount: 12000, currency: "MNT", metadata: { deal_id: "local" } });
  expect(requests[1].body).toEqual({ payment_intent: intent.id, success_url: back, cancel_url: back });
  expect(requests[3].body).toMatchObject({ charge: "ch_local", amount: 12000 });
});

it("reports missing Wire credentials before contacting the gateway", async () => {
  vi.stubEnv("WIRE_SECRET_KEY", "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(createIntent(12000, "Delivery", {}, "test")).rejects.toMatchObject({ code: "not_configured" });
  expect(fetch).not.toHaveBeenCalled();
});
