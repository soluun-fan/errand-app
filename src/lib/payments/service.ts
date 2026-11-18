import "server-only";
import { loadDeal, runCommand } from "@/lib/db/deals";
import { EngineError, amountDue, type ErrandDeal } from "@/lib/engine";
import { releaseOtherCommitments } from "@/lib/dispatch/rank";
import { runDispatch } from "@/lib/dispatch/run";
import { notify } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { fmtMoney } from "@/lib/format";
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
  const { data: open } = await db.from("provider_payments").select("id, amount, checkout_url, created_at").eq("deal_id", d.id).eq("purpose", purpose).eq("status", "pending").maybeSingle<{ id: string; amount: number; checkout_url: string | null; created_at: string }>();
  // resume a recent one (wire's checkout lives ~10 minutes); otherwise cancel it and start afresh
  if (open && open.amount === amount && open.checkout_url && Date.now() - Date.parse(open.created_at) < 8 * 60_000) return open.checkout_url;
  if (open) {
    await cancelIntent(open.id, `cancel-${open.id}`).catch(() => undefined);
    await db.from("provider_payments").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", open.id).eq("status", "pending");
  }
  const attempt = crypto.randomUUID();
  const intent = await createIntent(amount, `Tuslamj · ${d.title}`.slice(0, 120), { deal_id: d.id, purpose }, `pi-${d.id}-${purpose}-${attempt}`);
  const back = `${origin}/tasks/${d.id}`;
  const session = await createCheckout(intent.id, `${back}?paid=1`, back, `cs-${intent.id}`);
  if (!/^https:\/\//.test(session.url)) throw new Error("wire returned an unexpected checkout URL");
  await db.from("provider_payments").insert({ id: intent.id, provider: "wire", deal_id: d.id, purpose, amount, checkout_url: session.url }).throwOnError();
  return session.url;
}

/**
 * wire says an intent was paid (webhook or our own check). Idempotent: the engine ignores a payment
 * it already booked. If the task can't take it any more (e.g. the payment window passed), the money
 * goes straight back to the customer.
 */
export async function handlePaid(intentId: string, amount: number, charge: string | null): Promise<"booked" | "already" | "refunded" | "unknown"> {
  const db = createAdminClient();
  const { data: row } = await db.from("provider_payments").select("id, deal_id, status, amount, purpose").eq("id", intentId).maybeSingle<{ id: string; deal_id: string; status: string; amount: number; purpose: string }>();
  if (!row) return "unknown"; // not ours (or another project's); never book unknown money
  if (row.status === "succeeded" || row.status === "refunded_late") return "already";
  await db.from("provider_payments").update({ status: "succeeded", charge_id: charge, succeeded_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", intentId);
  try {
    // the purpose says which payment this was (first / shopping top-up / agreed higher price)
    const type = row.purpose.startsWith("topup-") ? "confirm_topup" : row.purpose.startsWith("price-") ? "confirm_price" : "confirm_payment";
    const paid = await runCommand(db, row.deal_id, { type, providerRef: intentId, amount }, { kind: "provider" });
    if (paid.deal.type === "errand") {
      if (type === "confirm_payment") await afterPaymentBooked(paid.deal);
      else if (type === "confirm_price" && paid.deal.helperId) {
        await notify([paid.deal.helperId], { title: "push.pricePaidTitle", body: "push.pricePaidBody", params: { fee: fmtMoney(paid.deal.fee), title: paid.deal.title }, url: `/jobs/${paid.deal.id}`, tag: `job-${paid.deal.id}` }).catch(() => undefined);
      }
    }
    return "booked";
  } catch (e) {
    if (!(e instanceof EngineError)) throw e; // a database hiccup: wire retries the webhook
    // the task moved on (paid twice, window passed, cancelled): give it back in full
    await db.from("provider_payments").update({ status: "refunded_late", updated_at: new Date().toISOString() }).eq("id", intentId);
    await db.from("provider_refunds").insert({ deal_id: row.deal_id, payment_id: intentId, amount, reason: `late payment: ${e.code}` }).throwOnError();
    await runRefunds(row.deal_id);
    const d = await loadDeal(db, row.deal_id);
    if (d?.type === "errand") {
      await notify([d.customerId], { title: "push.lateRefundTitle", body: "push.lateRefundBody", params: { title: d.title }, url: `/tasks/${d.id}`, tag: `task-${d.id}` }).catch(() => undefined);
    }
    return "refunded";
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
  const { data } = await db.from("provider_payments").select("id").eq("deal_id", dealId).eq("provider", "wire").eq("status", "pending").returns<{ id: string }[]>();
  for (const p of data ?? []) {
    const pi = await getIntent(p.id).catch(() => null);
    if (pi?.status === "succeeded") await handlePaid(pi.id, pi.amount, chargeOf(pi));
    else if (pi?.status === "canceled") await db.from("provider_payments").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", p.id).eq("status", "pending");
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
    .returns<{ id: string; amount: number; charge_id: string | null; status: string; provider: string }[]>();
  const wirePays = (pays ?? []).filter((p) => p.provider === "wire");
  if (!wirePays.length) return; // simulated payments: the ledger is the whole story
  const d = await loadDeal(db, dealId);
  if (!d || d.type !== "errand") return;
  const [{ data: ledger }, { data: asked }] = await Promise.all([
    // everything the ledger gave back to the customer: refunds AND the unspent shopping budget
    db.from("ledger_entries").select("amount").eq("deal_id", dealId).in("kind", REFUND_KINDS).eq("to_account", `ext:${d.customerId}`).returns<{ amount: number }[]>(),
    db.from("provider_refunds").select("payment_id, amount, status, reason").eq("deal_id", dealId).returns<{ payment_id: string; amount: number; status: string; reason: string | null }[]>(),
  ]);
  const refundedInLedger = (ledger ?? []).reduce((a, r) => a + Number(r.amount), 0);
  const requested = (asked ?? []).filter((r) => !(r.reason ?? "").startsWith("late payment")).reduce((a, r) => a + Number(r.amount), 0);
  let due = refundedInLedger - requested;
  for (const p of wirePays.filter((x) => x.status === "succeeded")) {
    if (due <= 0) break;
    const used = (asked ?? []).filter((r) => r.payment_id === p.id).reduce((a, r) => a + Number(r.amount), 0);
    const room = Number(p.amount) - used;
    const take = Math.min(room, due);
    if (take > 0) {
      await db.from("provider_refunds").insert({ deal_id: dealId, payment_id: p.id, amount: take, reason: "task refund" }).throwOnError();
      due -= take;
    }
  }
  // send every open request
  const { data: open } = await db
    .from("provider_refunds")
    .select("id, payment_id, amount, reason, attempts")
    .eq("deal_id", dealId)
    .in("status", ["pending", "failed"])
    .lt("attempts", 10)
    .returns<{ id: string; payment_id: string; amount: number; reason: string | null; attempts: number }[]>();
  for (const r of open ?? []) {
    const charge = wirePays.find((p) => p.id === r.payment_id)?.charge_id ?? chargeOf((await getIntent(r.payment_id).catch(() => null)) ?? {});
    if (!charge) {
      await db.from("provider_refunds").update({ status: "failed", error: "no charge id yet", attempts: r.attempts + 1, updated_at: new Date().toISOString() }).eq("id", r.id);
      continue;
    }
    try {
      const out = await refundCharge(charge, Number(r.amount), r.reason ?? "refund", `refund-${r.id}`);
      const status = out.status === "succeeded" || out.status === "pending" || out.status === "manual_required" ? out.status : "failed";
      await db.from("provider_refunds").update({ status, provider_ref: out.id, error: null, attempts: r.attempts + 1, updated_at: new Date().toISOString() }).eq("id", r.id);
    } catch (e) {
      const msg = e instanceof WireError ? `${e.status} ${e.code}: ${e.message}` : String(e);
      await db.from("provider_refunds").update({ status: "failed", error: msg.slice(0, 500), attempts: r.attempts + 1, updated_at: new Date().toISOString() }).eq("id", r.id);
    }
  }
}

/** Ledger kinds that return money to the customer and must become real refunds. */
export const REFUND_KINDS = ["refund", "budget_refund"] as const;

/** Background job: refunds that still need doing (new ones and retries). */
export async function sweepRefunds(): Promise<number> {
  if (activeProvider() !== "wire") return 0;
  const db = createAdminClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  // tasks paid through wire recently whose ledger may hold refunds not yet sent
  const { data } = await db.from("provider_payments").select("deal_id").eq("provider", "wire").in("status", ["succeeded", "refunded_late"]).gte("created_at", since).returns<{ deal_id: string }[]>();
  const ids = [...new Set((data ?? []).map((r) => r.deal_id))];
  for (const id of ids) await runRefunds(id).catch((e) => console.error("refund sweep failed", id, e));
  return ids.length;
}
