import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { sendOtpSms } = vi.hoisted(() => ({ sendOtpSms: vi.fn() }));
vi.mock("@/lib/error-log", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/sms", async (orig) => ({ ...(await orig<typeof import("@/lib/sms")>()), sendOtpSms }));
import { POST } from "./route";

const secret = "v1,whsec_" + Buffer.from("test-secret-key-32-bytes-long!!!").toString("base64");
function signed(body: object) {
  const raw = JSON.stringify(body);
  const id = "msg_1";
  const ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  return new Request("http://localhost/api/auth/sms", { method: "POST", body: raw, headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` } });
}

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("SEND_SMS_HOOK_SECRET", secret); });
afterEach(() => vi.unstubAllEnvs());

it("sends login codes only to Mongolian numbers (no paying for SMS abroad)", async () => {
  sendOtpSms.mockResolvedValue(undefined);
  expect((await POST(signed({ user: { phone: "97688112233" }, sms: { otp: "123456" } }))).status).toBe(200);
  expect(sendOtpSms).toHaveBeenCalledTimes(1);
  for (const phone of ["447700900123", "8615012345678", "9768811223"]) {
    expect((await POST(signed({ user: { phone }, sms: { otp: "123456" } }))).status).toBe(400);
  }
  expect(sendOtpSms).toHaveBeenCalledTimes(1);
});

it("refuses unsigned calls", async () => {
  const r = await POST(new Request("http://localhost/api/auth/sms", { method: "POST", body: "{}" }));
  expect(r.status).toBe(401);
});
