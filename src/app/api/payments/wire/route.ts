import { handlePaid } from "@/lib/payments/service";
import { SIGNATURE_HEADER, chargeOf, verifySignature } from "@/lib/payments/wire";
import { createAdminClient } from "@/lib/supabase/admin";

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
  let event: { id?: string; type?: string; data?: { id?: string; amount?: number; status?: string; charge?: string | null; latest_charge?: string | null } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  // wire.mn's signed check when the endpoint is verified from its dashboard: the signature already
  // proved it's them, so just say yes (it may not carry an event id we'd otherwise insist on)
  if (event.type === "endpoint.verification") return Response.json({ ok: true });
  if (!event.id || !event.type) return new Response("bad event", { status: 400 });
  const db = createAdminClient();
  const { data: seen } = await db.from("provider_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return Response.json({ ok: true, duplicate: true });

  try {
    const d = event.data ?? {};
    if (event.type === "payment_intent.succeeded" && d.id && Number.isSafeInteger(d.amount)) {
      await handlePaid(d.id, d.amount as number, chargeOf(d));
    } else if ((event.type === "payment_intent.canceled" || event.type === "payment_intent.payment_failed") && d.id) {
      await db
        .from("provider_payments")
        .update({ status: event.type === "payment_intent.canceled" ? "canceled" : "failed", updated_at: new Date().toISOString() })
        .eq("id", d.id)
        .eq("status", "pending").throwOnError();
    } else if (event.type === "charge.refunded" && d.id) {
      const status = d.status === "succeeded" || d.status === "pending" || d.status === "manual_required" || d.status === "failed" ? d.status : null;
      if (status) await db.from("provider_refunds").update({ status, updated_at: new Date().toISOString() }).eq("provider_ref", d.id).throwOnError();
    }
    // remembered only after it was handled, so a failure above is retried by wire
    await db.from("provider_events").upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true }).throwOnError();
    return Response.json({ ok: true });
  } catch (e) {
    console.error("wire webhook failed", event.type, e);
    return new Response("try again", { status: 500 });
  }
}
