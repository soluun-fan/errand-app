import { createHmac, timingSafeEqual } from "node:crypto";
import { APP_NAME_LATIN } from "@/lib/brand";

/**
 * Real SMS for login codes (docs/deploy.md "SMS"). Supabase Auth's "Send SMS" hook, set to HTTP,
 * posts each code to /api/auth/sms (signed, Standard Webhooks). We send it through a Mongolian SMS
 * gateway configured by settings, not code — most gateways take one HTTP request:
 *
 *   SMS_PROVIDER=http
 *   SMS_HTTP_URL      e.g. https://api.gateway.mn/send?key=KEY&to={phone_local}&text={text}
 *   SMS_HTTP_METHOD   GET (default) or POST
 *   SMS_HTTP_BODY     for POST, e.g. {"to":"{phone}","message":"{text}"}  (JSON) or to={phone}&text={text}
 *   SMS_HTTP_HEADERS  JSON, e.g. {"Authorization":"Bearer KEY","Content-Type":"application/json"}
 *   SMS_HTTP_OK       optional text/regex the reply must contain to count as sent
 *
 * Placeholders: {phone} = 976XXXXXXXX, {phone_local} = XXXXXXXX, {text} = the message, {otp} = the code.
 * In a URL they're URL-encoded; in a JSON body JSON-escaped.
 */

/** Standard Webhooks check: "v1,<base64 HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)>", 5-minute window. */
export function verifyHookSignature(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowMs = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** The login text: Latin letters so it fits one SMS on every phone (Cyrillic halves the length). */
export const otpText = (otp: string) => `${APP_NAME_LATIN}: tany nevtrekh kod ${otp}. Hend ch buu hel.`;

export interface SmsRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

/** Fill the configured request for one message. Throws if the settings are missing or broken. */
export function buildSmsRequest(env: Record<string, string | undefined>, phone: string, otp: string): SmsRequest {
  const digits = phone.replace(/\D/g, "");
  const full = digits.length === 8 ? `976${digits}` : digits;
  const vars: Record<string, string> = { phone: full, phone_local: full.replace(/^976/, ""), text: otpText(otp), otp };
  const fill = (tpl: string, enc: (v: string) => string) => tpl.replace(/\{(phone_local|phone|text|otp)\}/g, (_, k: string) => enc(vars[k]));
  const urlTpl = env.SMS_HTTP_URL;
  if (!urlTpl || !/^https:\/\//.test(urlTpl)) throw new Error("SMS_HTTP_URL must be an https URL");
  const method = (env.SMS_HTTP_METHOD ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
  let headers: Record<string, string> = {};
  if (env.SMS_HTTP_HEADERS) {
    const parsed = JSON.parse(env.SMS_HTTP_HEADERS) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("SMS_HTTP_HEADERS must be a JSON object");
    headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  }
  const url = fill(urlTpl, encodeURIComponent);
  if (method === "GET") return { url, method, headers };
  const bodyTpl = env.SMS_HTTP_BODY ?? "";
  const json = bodyTpl.trim().startsWith("{");
  const body = fill(bodyTpl, json ? (v) => JSON.stringify(v).slice(1, -1) : encodeURIComponent);
  if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["Content-Type"] = json ? "application/json" : "application/x-www-form-urlencoded";
  return { url, method, headers, body };
}

/** Send one login code. Resolves when the gateway accepted it; throws otherwise. */
export async function sendOtpSms(phone: string, otp: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  if (env.SMS_PROVIDER !== "http") throw new Error("SMS_PROVIDER is not 'http'");
  const req = buildSmsRequest(env, phone, otp);
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(10_000) });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`SMS gateway ${res.status}: ${text.slice(0, 200)}`);
  if (env.SMS_HTTP_OK && !new RegExp(env.SMS_HTTP_OK).test(text)) throw new Error(`SMS gateway reply not OK: ${text.slice(0, 200)}`);
}
