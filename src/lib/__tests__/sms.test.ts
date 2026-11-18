import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSmsRequest, otpText, verifyHookSignature } from "../sms";

/** Login-code SMS (docs/deploy.md "SMS"): only Supabase's signed calls; the gateway request is filled from settings. */
const SECRET_RAW = Buffer.from("test-secret-key-0123456789abcdef");
const SECRET = `v1,whsec_${SECRET_RAW.toString("base64")}`;
const sign = (id: string, ts: number, body: string) => `v1,${createHmac("sha256", SECRET_RAW).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("Send SMS hook signature", () => {
  const body = JSON.stringify({ user: { phone: "97688000001" }, sms: { otp: "123456" } });
  const now = 1_800_000_000_000;
  const ts = Math.floor(now / 1000);
  it("accepts Supabase's signature and refuses anything else", () => {
    expect(verifyHookSignature(SECRET, { id: "msg_1", timestamp: String(ts), signature: sign("msg_1", ts, body) }, body, now)).toBe(true);
    expect(verifyHookSignature(SECRET, { id: "msg_1", timestamp: String(ts), signature: sign("msg_1", ts, body) }, body.replace("123456", "999999"), now)).toBe(false);
    expect(verifyHookSignature(SECRET, { id: "msg_1", timestamp: String(ts), signature: "v1,AAAA" }, body, now)).toBe(false);
    expect(verifyHookSignature(SECRET, { id: "msg_1", timestamp: String(ts - 600), signature: sign("msg_1", ts - 600, body) }, body, now)).toBe(false); // too old
    expect(verifyHookSignature("", { id: "msg_1", timestamp: String(ts), signature: sign("msg_1", ts, body) }, body, now)).toBe(false);
  });
});

describe("gateway request from settings", () => {
  it("fills a GET URL, URL-encoded, with the local number", () => {
    const r = buildSmsRequest({ SMS_HTTP_URL: "https://gw.example.mn/send?key=K&to={phone_local}&text={text}" }, "97688112233", "123456");
    expect(r.method).toBe("GET");
    expect(r.url).toBe(`https://gw.example.mn/send?key=K&to=88112233&text=${encodeURIComponent(otpText("123456"))}`);
  });

  it("fills a JSON POST body (escaped) and its headers", () => {
    const r = buildSmsRequest(
      { SMS_HTTP_URL: "https://gw.example.mn/api", SMS_HTTP_METHOD: "post", SMS_HTTP_BODY: '{"to":"{phone}","message":"{text}"}', SMS_HTTP_HEADERS: '{"Authorization":"Bearer T"}' },
      "88112233",
      "654321",
    );
    expect(r).toMatchObject({ method: "POST", headers: { Authorization: "Bearer T", "Content-Type": "application/json" } });
    expect(JSON.parse(r.body as string)).toEqual({ to: "97688112233", message: otpText("654321") });
  });

  it("refuses a missing or non-https URL", () => {
    expect(() => buildSmsRequest({}, "88112233", "1")).toThrow(/SMS_HTTP_URL/);
    expect(() => buildSmsRequest({ SMS_HTTP_URL: "http://gw.example.mn" }, "88112233", "1")).toThrow(/https/);
  });
});
