import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), write: vi.fn(), handlePaid: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/payments/service", () => ({ handlePaid: mocks.handlePaid }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let reading = true;
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: () => q,
        update: () => {
          reading = false;
          return q;
        },
        upsert: () => {
          reading = false;
          return q;
        },
        throwOnError: () => (reading ? mocks.lookup() : mocks.write()),
      };
      return q;
    },
  }),
}));
import { POST } from "./route";

const secret = "local-webhook-test";
const paid = {
  id: "evt_test",
  type: "payment_intent.succeeded",
  data: { id: "pi_test", amount: 12000, currency: "MNT", status: "succeeded", charge: "ch_test" },
};
function request(body: unknown, signed = true): Request {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return new Request("http://localhost/api/payments/wire", {
    method: "POST",
    body: raw,
    headers: signed ? { "wirepayment-signature": `t=${timestamp},v1=${signature}` } : {},
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WIRE_WEBHOOK_SECRET", secret);
  mocks.lookup.mockResolvedValue({ data: null });
  mocks.write.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("verifies signatures before any database access", async () => {
  expect((await POST(request(paid, false))).status).toBe(400);
  expect(mocks.lookup).not.toHaveBeenCalled();
});
it("accepts the signed endpoint verification without an event id", async () => {
  expect((await POST(request({ type: "endpoint.verification" }))).status).toBe(200);
  expect(mocks.lookup).not.toHaveBeenCalled();
});
it.each([null, [], "event", { id: 10, type: "event" }])("rejects malformed event envelopes without crashing: %j", async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(mocks.write).not.toHaveBeenCalled();
});
it("applies a validated payment before acknowledging it", async () => {
  expect((await POST(request(paid))).status).toBe(200);
  expect(mocks.handlePaid).toHaveBeenCalledWith("pi_test", 12000, "ch_test");
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.handlePaid.mock.invocationCallOrder[0]).toBeLessThan(mocks.write.mock.invocationCallOrder[0]);
});
it.each([
  undefined,
  null,
  {},
  { ...paid.data, amount: "12000" },
  { ...paid.data, amount: -1 },
  { ...paid.data, currency: "USD" },
  { ...paid.data, charge: {} },
])("keeps incompatible signed payments retryable instead of dropping them: %j", async (data) => {
  expect((await POST(request({ ...paid, data }))).status).toBe(500);
  expect(mocks.handlePaid).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});
it("acknowledges already handled events without applying them again", async () => {
  mocks.lookup.mockResolvedValue({ data: { id: paid.id } });
  expect(await (await POST(request(paid))).json()).toEqual({ ok: true, duplicate: true });
  expect(mocks.handlePaid).not.toHaveBeenCalled();
});
it("retries a failed duplicate check without processing or recording the payment", async () => {
  mocks.lookup.mockRejectedValue(new Error("database unavailable"));
  expect((await POST(request(paid))).status).toBe(500);
  expect(mocks.handlePaid).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});
it("does not acknowledge a payment that failed to apply", async () => {
  mocks.handlePaid.mockRejectedValue(new Error("payment mismatch"));
  expect((await POST(request(paid))).status).toBe(500);
  expect(mocks.write).not.toHaveBeenCalled();
});
