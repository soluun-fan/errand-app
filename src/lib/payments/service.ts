import "server-only";
import { applyTransitionArgs } from "@/lib/db/mapping";
import { DbError, loadDeal } from "@/lib/db/deals";
import { EngineError, apply, amountDue, type ErrandDeal } from "@/lib/engine";
import { releaseOtherCommitments } from "@/lib/dispatch/rank";
import { runDispatch } from "@/lib/dispatch/run";
import { notify } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { fmtMoney } from "@/lib/format";
import { APP_NAME_LATIN } from "@/lib/brand";
import { cancelIntent, chargeOf, createCheckout, createIntent, getIntent, refundCharge, WireError } from "./wire";

/**
 * Payments through wire.mn (docs/decisions.md 2026-11-18 "Direct pay + wire.mn", then "Managed
 * service": the customer prepays the full amount to us). The engine stays
 * the judge: a payment counts only when `confirm_payment` accepts it (right amount, right state,
 * never twice). This module talks to wire, remembers each payment, and turns the engine's refunds
 * into real refunds — retried by the background job until wire has done them.
 */
export type ProviderName = "mock" | "wire";

/**
 * wire when PAYMENT_PROVIDER=wire — even if its key is missing (then paying fails loudly instead of
 * falling back to the simulated button, which would let anyone "pay" for free). Otherwise mock.
 */
export function activeProvider(): ProviderName {
  return process.env.PAYMENT_PROVIDER === "wire" ? "wire" : "mock";
}

/** Which payment this is: the first one after being chosen (a re-chosen task pays again). */
export const firstPaymentPurpose = (d: ErrandDeal) => `fee-${d.assignedAt ?? 0}`;

/** What a payment is for: the first one, a shopping top-up, or an agreed higher price. */
export type PaymentKind = "first" | "topup" | "price";

/** The purpose (one live payment per purpose) and amount the task needs now, or null if it needs none. */
export function paymentFor(d: ErrandDeal, kind: PaymentKind): { purpose: string; amount: number } | null {
  if (kind === "first") return d.status === "awaiting_payment" ? { purpose: firstPaymentPurpose(d), amount: amountDue(d) } : null;
  if (kind === "topup") return d.topUp?.status === "pending" ? { purpose: `topup-${d.topUp.at}`, amount: d.topUp.amount } : null;
  const pc = d.priceChange;
  return pc && pc.status === "awaiting_payment" && pc.fee > d.fee ? { purpose: `price-${pc.at}`, amount: pc.fee - d.fee } : null;
}

/**
 * Start (or resume) the customer's payment for what the task needs now. Returns wire's checkout URL.
 * `origin` is our site's address, for wire to send the customer back to.
 */
export async function startWirePayment(d: ErrandDeal, origin: string, kind: PaymentKind = "first"): Promise<string> {
  const need = paymentFor(d, kind);
  if (!need) throw new Error("nothing to pay");
  if (kind !== "first" && d.payMode === "direct") throw new Error("fee-only tasks pay only the fee");
  const db = createAdminClient();
  const { purpose, amount } = need;
  const { data: open } = await db.from("provider_payments").select("id, amount, checkout_url, created_at").eq("deal_id", d.id).eq("purpose", purpose).eq("status", "pending").maybeSingle<{ id: string; amount: number; checkout_url: string | null; created_at: string }>().throwOnError();
  // resume a recent one (wire's checkout lives ~10 minutes); otherwise cancel it and start afresh
  if (open && open.amount === amount && open.checkout_url && Date.now() - Date.parse(open.created_at) < 8 * 60_000) return open.checkout_url;
  if (open) {
    const canceled = await cancelIntent(open.id, `cancel-${open.id}`);
    if (canceled.status === "succeeded") {
      await handlePaid(canceled.id, canceled.amount, chargeOf(canceled));
      throw new Error("Wire payment already succeeded; reload the task");
    }
    if (canceled.status !== "canceled") throw new Error("Wire payment could not be safely canceled");
    await db.from("provider_payments").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", open.id).eq("status", "pending").throwOnError();
  }
  const attempt = crypto.randomUUID();
  const intent = await createIntent(amount, `${APP_NAME_LATIN} · ${d.title}`.slice(0, 120), { deal_id: d.id, purpose }, `pi-${d.id}-${purpose}-${attempt}`);
  try {
    // Record the intent before creating a customer-accessible checkout. A later webhook can then
    // always reconcile a payment even if the checkout request or this server process fails.
    await db.from("provider_payments").insert({ id: intent.id, provider: "wire", deal_id: d.id, purpose, amount }).throwOnError();
  } catch (error) {
    try {
      const canceled = await cancelIntent(intent.id, `cancel-${intent.id}`);
      if (canceled.status !== "canceled") throw new Error("Wire intent was not canceled");
      await db.from("provider_payments").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", intent.id).eq("status", "pending").throwOnError();
    } catch (cancelError) {
      console.error("Wire intent cleanup failed", intent.id, cancelError instanceof WireError ? `${cancelError.status} ${cancelError.code}` : "unexpected error");
    }
    throw error;
  }
  const back = `${origin}/tasks/${d.id}`;
  try {
    const session = await createCheckout(intent.id, `${back}?paid=1`, back, `cs-${intent.id}`);
    if (!/^https:\/\//.test(session.url)) throw new Error("wire returned an unexpected checkout URL");
    await db.from("provider_payments").update({ checkout_url: session.url, updated_at: new Date().toISOString() }).eq("id", intent.id).eq("status", "pending").select("id").single().throwOnError();
    return session.url;
  } catch (error) {
    try {
      const canceled = await cancelIntent(intent.id, `cancel-${intent.id}`);
      if (canceled.status === "succeeded") {
        await handlePaid(canceled.id, canceled.amount, chargeOf(canceled));
      } else if (canceled.status === "canceled") {
        await db.from("provider_payments").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", intent.id).eq("status", "pending").throwOnError();
      } else {
        throw new Error("Wire intent was not canceled");
      }
    } catch (cancelError) {
      console.error("Wire checkout cleanup failed", intent.id, cancelError instanceof WireError ? `${cancelError.status} ${cancelError.code}` : "unexpected error");
    }
    throw error;
  }
}

/**
 * wire says an intent was paid (webhook or our own check). Idempotent: the engine ignores a payment
 * it already booked. If the task can't take it any more (e.g. the payment window passed), the money
 * goes straight back to the customer.
 */
export async function handlePaid(intentId: string, amount: number, charge: string | null): Promise<"booked" | "already" | "refunded" | "unknown"> {
  const db = createAdminClient();
  const { data: row } = await db.from("provider_payments").select("deal_id, amount, purpose").eq("id", intentId)
    .eq("provider", "wire").maybeSingle<{ deal_id: string; amount: number; purpose: string }>().throwOnError();
  if (!row) return "unknown";
  const kind = row.purpose.startsWith("topup-") ? "topup" : row.purpose.startsWith("price-") ? "price" : "first";
  const type = kind === "topup" ? "confirm_topup" : kind === "price" ? "confirm_price" : "confirm_payment";

  for (let attempt = 1; ; attempt++) {
    const before = await loadDeal(db, row.deal_id);
    if (before?.type !== "errand") throw new Error("Wire payment task missing");
    const need = paymentFor(before, kind);
    const now = Date.now();
    let transition = null;
    if (need?.purpose === row.purpose && need.amount === amount && Number(row.amount) === amount) {
      try {
        transition = apply(before, { type, providerRef: intentId, amount }, { now, actor: { kind: "provider" } });
      } catch (error) {
        if (!(error instanceof EngineError) || !["ILLEGAL_TRANSITION", "PAYMENT_MISMATCH"].includes(error.code)) throw error;
      }
    }
    const { data, error } = await db.rpc("settle_wire_payment", {
      p_intent: intentId, p_amount: amount, p_charge: charge, p_version: before.version,
      p_transition: transition ? applyTransitionArgs(before, transition, now) : null,
    });
    if (error?.code === "PT409" && attempt < 3) continue;
    if (error) throw new DbError(error);
    if (data === "already" || data === "unknown") return data;
    if (data === "refunded") {
      await runRefunds(row.deal_id);
      await notify([before.customerId], { title: "push.lateRefundTitle", body: "push.lateRefundBody", params: { title: before.title }, url: `/tasks/${before.id}`, tag: `task-${before.id}` }).catch(() => undefined);
      return data;
    }
    if (data !== "booked" || transition?.deal.type !== "errand") throw new Error("Unexpected Wire settlement result");
    const deal = transition.deal;
    if (type === "confirm_payment") await afterPaymentBooked(deal);
    else if (type === "confirm_price" && deal.helperId) {
      await notify([deal.helperId], { title: "push.pricePaidTitle", body: "push.pricePaidBody", params: { fee: fmtMoney(deal.fee), title: deal.title }, url: `/jobs/${deal.id}`, tag: `job-${deal.id}` }).catch(() => undefined);
    }
    return data;
  }
}

/**
 * A task's first payment was booked (wire or simulated): the helper is busy now — their other
 * applications and unpaid matches step back, the other offers close, and the helper is told to go.
 */
export async function afterPaymentBooked(d: ErrandDeal): Promise<void> {
  if (!d.helperId) return;
  await releaseOtherCommitments(d.helperId, d.id).catch((e) => console.error("release commitments failed", e));
  await runDispatch(d.id).catch((e) => console.error("dispatch after payment failed", e));
  await notify([d.helperId], { title: "push.paidTitle", body: d.payMode === "direct" ? "push.paidDirectBody" : "push.paidBody", params: { title: d.title }, url: `/jobs/${d.id}`, tag: `job-${d.id}` }).catch(
    () => undefined,
  );
}

/** The customer came back from wire's page (or the screen is waiting): ask wire directly. */
export async function checkWirePayments(dealId: string): Promise<void> {
  if (activeProvider() !== "wire") return;
  const db = createAdminClient();
  const { data } = await db.from("provider_payments").select("id").eq("deal_id", dealId).eq("provider", "wire").or("status.eq.pending,needs_reconciliation.eq.true").returns<{ id: string }[]>().throwOnError();
  for (const p of data ?? []) {
    let pi: Awaited<ReturnType<typeof getIntent>>;
    try {
      pi = await getIntent(p.id);
    } catch (error) {
      console.error("Wire payment status check failed", p.id, error instanceof WireError ? `${error.status} ${error.code}` : "unexpected error");
      continue;
    }
    if (pi.status === "succeeded") await handlePaid(pi.id, pi.amount, chargeOf(pi));
    else if (pi.status === "canceled") {
      await db.from("provider_payments").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", p.id).eq("status", "pending").throwOnError();
    }
  }
}

/**
 * Turn the engine's refunds into real refunds for wire-paid tasks: what the ledger refunded to the
 * customer, minus what we already asked wire to refund, is asked for now (against the charges, newest
 * first); then every open request is (re)sent, with its own id as the idempotency key.
 */
export async function runRefunds(dealId: string): Promise<void> {
  const db = createAdminClient();
  const { data: pays } = await db
    .from("provider_payments")
    .select("id, amount, charge_id, status, provider")
    .eq("deal_id", dealId)
    .in("status", ["succeeded", "refunded_late"])
    .order("succeeded_at", { ascending: false })
    .returns<{ id: string; amount: number; charge_id: string | null; status: string; provider: string }[]>()
    .throwOnError();
  const wirePays = (pays ?? []).filter((p) => p.provider === "wire");
  if (!wirePays.length) return; // simulated payments: the ledger is the whole story
  await db.rpc("queue_wire_refunds", { p_deal: dealId }).throwOnError();
  // send every open request
  const { data: open } = await db
    .from("provider_refunds")
    .select("id, payment_id, amount, reason, attempts")
    .eq("deal_id", dealId)
    .in("status", ["pending", "failed"])
    .lt("attempts", 10)
    .returns<{ id: string; payment_id: string; amount: number; reason: string | null; attempts: number }[]>()
    .throwOnError();
  for (const r of open ?? []) {
    const charge = wirePays.find((p) => p.id === r.payment_id)?.charge_id ?? chargeOf((await getIntent(r.payment_id).catch(() => null)) ?? {});
    if (!charge) {
      await db.from("provider_refunds").update({ status: "failed", error: "no charge id yet", attempts: r.attempts + 1, updated_at: new Date().toISOString() }).eq("id", r.id).in("status", ["failed", "pending"]).throwOnError();
      continue;
    }
    try {
      const out = await refundCharge(charge, Number(r.amount), r.reason ?? "refund", `refund-${r.id}`);
      const status = out.status === "succeeded" || out.status === "pending" || out.status === "manual_required" ? out.status : "failed";
      await db.from("provider_refunds").update({ status, provider_ref: out.id, error: null, attempts: r.attempts + 1, updated_at: new Date().toISOString() }).eq("id", r.id).in("status", ["failed", "pending"]).throwOnError();
    } catch (e) {
      const msg = e instanceof WireError ? `${e.status} ${e.code}: ${e.message}` : String(e);
      await db.from("provider_refunds").update({ status: "failed", error: msg.slice(0, 500), attempts: r.attempts + 1, updated_at: new Date().toISOString() }).eq("id", r.id).in("status", ["failed", "pending"]).throwOnError();
    }
  }
}

/** Background job: refunds that still need doing (new ones and retries). */
export async function sweepRefunds(): Promise<number> {
  if (activeProvider() !== "wire") return 0;
  const db = createAdminClient();
  const { data: repairs } = await db.from("provider_payments").select("deal_id").eq("needs_reconciliation", true)
    .limit(100).returns<{ deal_id: string }[]>().throwOnError();
  for (const id of new Set((repairs ?? []).map(r => r.deal_id))) {
    await checkWirePayments(id).catch(e => console.error("Wire reconciliation failed", id, e));
  }
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  // tasks paid through wire recently whose ledger may hold refunds not yet sent
  const { data } = await db.from("provider_payments").select("deal_id").eq("provider", "wire").in("status", ["succeeded", "refunded_late"]).gte("created_at", since).returns<{ deal_id: string }[]>();
  const ids = [...new Set([...(data ?? []), ...(repairs ?? [])].map((r) => r.deal_id))];
  for (const id of ids) await runRefunds(id).catch((e) => console.error("refund sweep failed", id, e));
  return ids.length;
}
