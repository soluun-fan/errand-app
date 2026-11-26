import { handlePaid } from "@/lib/payments/service";
import { SIGNATURE_HEADER, chargeOf, verifySignature } from "@/lib/payments/wire";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const eventSchema = z.object({ id: z.string().min(1).optional(), type: z.string().min(1), data: z.unknown().optional() });
const paymentIdSchema = z.object({ id: z.string().min(1) });
const paidSchema = paymentIdSchema.extend({
  amount: z.number().int().nonnegative(),
  // "MNT" is what we send; accept any letter case so a casing change on wire's side can't stall payments
  currency: z.string().refine((c) => c.toUpperCase() === "MNT"),
  status: z.literal("succeeded"),
  charge: z.string().min(1).nullish(),
  latest_charge: z.string().min(1).nullish(),
});
const refundSchema = paymentIdSchema.extend({ status: z.enum(["succeeded", "pending", "manual_required", "failed"]) });

/**
 * wire.mn webhook (docs/decisions.md 2026-11-18 "Direct pay + wire.mn"). Nothing is trusted until
 * the `WirePayment-Signature` checks out against the raw body with our endpoint secret. Handling is
 * idempotent (the engine books a payment once); an event already handled is acknowledged and skipped.
 * 2xx = done; 5xx = wire retries later.
 */
export async function POST(request: Request) {
  const secret = process.env.WIRE_WEBHOOK_SECRET ?? "";
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get(SIGNATURE_HEADER), secret)) {
    return new Response("bad signature", { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return new Response("bad event", { status: 400 });
  const event = parsed.data;
  // wire.mn's signed check when the endpoint is verified from its dashboard: the signature already
  // proved it's them, so just say yes (it may not carry an event id we'd otherwise insist on)
  if (event.type === "endpoint.verification") return Response.json({ ok: true });
  if (!event.id || !event.type) return new Response("bad event", { status: 400 });
  try {
    const db = createAdminClient();
    const { data: seen } = await db.from("provider_events").select("id").eq("id", event.id).maybeSingle().throwOnError();
    if (seen) return Response.json({ ok: true, duplicate: true });

    // Validate the fields we act on. A signed but incompatible payment must be retried,
    // never recorded as handled without applying it (Wire drops ordinary 4xx responses).
    if (event.type === "payment_intent.succeeded") {
      const d = paidSchema.parse(event.data);
      await handlePaid(d.id, d.amount, chargeOf(d));
    } else if (event.type === "payment_intent.canceled" || event.type === "payment_intent.payment_failed") {
      const d = paymentIdSchema.parse(event.data);
      await db
        .from("provider_payments")
        .update({ status: event.type === "payment_intent.canceled" ? "canceled" : "failed", updated_at: new Date().toISOString() })
        .eq("id", d.id)
        .eq("status", "pending")
        .throwOnError();
    } else if (event.type === "charge.refunded") {
      const d = refundSchema.parse(event.data);
      await db
        .from("provider_refunds")
        .update({ status: d.status, updated_at: new Date().toISOString() })
        .eq("provider_ref", d.id)
        .throwOnError();
    }
    // remembered only after it was handled, so a failure above is retried by wire
    await db
      .from("provider_events")
      .upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true })
      .throwOnError();
    return Response.json({ ok: true });
  } catch (e) {
    console.error("wire webhook failed", event.type, e);
    return new Response("try again", { status: 500 });
  }
}
