import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * wire.mn — Mongolian payment gateway (QPay, bank apps, cards…) behind one API (https://docs.wire.mn).
 * We use: PaymentIntents + hosted checkout to take our service fee, signed webhooks to learn it was
 * paid, and refunds (against the charge). Keys stay in the environment (WIRE_SECRET_KEY = sk_live_…,
 * WIRE_WEBHOOK_SECRET = whsec_…); wire has no test mode, so tests use recorded shapes.
 */
const BASE = "https://api.wire.mn/v1";
export const SIGNATURE_HEADER = "wirepayment-signature";
/** Reject webhook deliveries older or newer than this (the SDKs' default). */
export const SIGNATURE_TOLERANCE_S = 300;

export interface WireIntent {
  id: string;
  status: "requires_payment_method" | "requires_action" | "processing" | "requires_capture" | "succeeded" | "canceled" | string;
  amount: number;
  currency: string;
  /** set once paid (refunds go against it) */
  charge?: string | null;
  latest_charge?: string | null;
  expires_at?: number | null;
  metadata?: Record<string, string> | null;
}

export interface WireRefund {
  id: string;
  status: "succeeded" | "manual_required" | "pending" | "failed" | string;
  amount: number;
}

export class WireError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function wireConfigured(): boolean {
  return Boolean(process.env.WIRE_SECRET_KEY);
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const key = process.env.WIRE_SECRET_KEY;
  if (!key) throw new WireError(0, "not_configured", "WIRE_SECRET_KEY is not set");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new WireError(res.status, err?.code ?? "http_error", err?.message ?? `wire ${method} ${path} → ${res.status}`);
  }
  return json as T;
}

/** A payment for `amount` ₮; `idempotencyKey` makes a retried request create it only once. */
export function createIntent(amount: number, description: string, metadata: Record<string, string>, idempotencyKey: string): Promise<WireIntent> {
  return call<WireIntent>("POST", "/payment_intents", { amount, currency: "MNT", description, metadata }, idempotencyKey);
}

/** wire's hosted payment page for an intent (QR, bank apps, cards); the customer is sent to `url`. */
export function createCheckout(intentId: string, successUrl: string, cancelUrl: string, idempotencyKey: string): Promise<{ id: string; url: string }> {
  return call("POST", "/checkout/sessions", { payment_intent: intentId, success_url: successUrl, cancel_url: cancelUrl }, idempotencyKey);
}

export function getIntent(id: string): Promise<WireIntent> {
  return call<WireIntent>("GET", `/payment_intents/${encodeURIComponent(id)}`);
}

export function cancelIntent(id: string, idempotencyKey: string): Promise<WireIntent> {
  return call<WireIntent>("POST", `/payment_intents/${encodeURIComponent(id)}/cancel`, {}, idempotencyKey);
}

export function refundCharge(charge: string, amount: number, reason: string, idempotencyKey: string): Promise<WireRefund> {
  return call<WireRefund>("POST", "/refunds", { charge, amount, reason: reason.slice(0, 500) }, idempotencyKey);
}

/** The charge of a paid intent, whichever field wire filled. */
export const chargeOf = (pi: Pick<WireIntent, "charge" | "latest_charge">): string | null => pi.charge ?? pi.latest_charge ?? null;

/**
 * Checks `WirePayment-Signature: t=<unix s>,v1=<hex>` — HMAC-SHA256 with the endpoint secret over
 * `${t}.${rawBody}`, compared in constant time, timestamp within the tolerance. Pure; tested.
 */
export function verifySignature(rawBody: string, header: string | null, secret: string, nowMs = Date.now(), toleranceS = SIGNATURE_TOLERANCE_S): boolean {
  if (!header || !secret) return false;
  const parts = new Map<string, string[]>();
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i <= 0) continue;
    const k = piece.slice(0, i).trim();
    parts.set(k, [...(parts.get(k) ?? []), piece.slice(i + 1).trim()]);
  }
  const t = Number(parts.get("t")?.[0]);
  const sigs = parts.get("v1") ?? [];
  if (!Number.isInteger(t) || !sigs.length) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return sigs.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s) || s.length !== expected.length * 2) return false;
    return timingSafeEqual(Buffer.from(s, "hex"), expected);
  });
}
