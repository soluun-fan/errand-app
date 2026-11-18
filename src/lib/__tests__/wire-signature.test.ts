import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { verifySignature } = await import("@/lib/payments/wire");

/** wire.mn webhook signatures: `t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>` (docs.wire.mn webhooks). */
const secret = "whsec_test_secret";
const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded", data: { id: "pi_1", amount: 2000 } });
const sign = (t: number, b = body, s = secret) => createHmac("sha256", s).update(`${t}.${b}`).digest("hex");
const NOW = 1_800_000_000_000;

describe("wire webhook signature", () => {
  const t = NOW / 1000;
  it("accepts the right signature within 5 minutes", () => {
    expect(verifySignature(body, `t=${t},v1=${sign(t)}`, secret, NOW)).toBe(true);
    expect(verifySignature(body, `t=${t - 200},v1=${sign(t - 200)}`, secret, NOW)).toBe(true);
  });
  it("refuses a changed body, a wrong secret, an old or future timestamp, or junk", () => {
    expect(verifySignature(body + " ", `t=${t},v1=${sign(t)}`, secret, NOW)).toBe(false);
    expect(verifySignature(body, `t=${t},v1=${sign(t, body, "whsec_other")}`, secret, NOW)).toBe(false);
    expect(verifySignature(body, `t=${t - 301},v1=${sign(t - 301)}`, secret, NOW)).toBe(false);
    expect(verifySignature(body, `t=${t + 400},v1=${sign(t + 400)}`, secret, NOW)).toBe(false);
    expect(verifySignature(body, null, secret, NOW)).toBe(false);
    expect(verifySignature(body, "garbage", secret, NOW)).toBe(false);
    expect(verifySignature(body, `t=${t},v1=zz`, secret, NOW)).toBe(false);
    expect(verifySignature(body, `t=${t},v1=${sign(t)}`, "", NOW)).toBe(false); // no secret configured: never trust
  });
  it("accepts any one of several v1 signatures (secret rotation)", () => {
    expect(verifySignature(body, `t=${t},v1=${"0".repeat(64)},v1=${sign(t)}`, secret, NOW)).toBe(true);
  });
});
