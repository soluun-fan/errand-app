"use server";

import { refresh } from "next/cache";
import { isOnboarded } from "@/lib/legal-rules";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { PhotoIdsJson, Uuid, parseOr } from "@/lib/input";
import { attachTaskPhotos, photosEditable, removeTaskPhoto } from "@/lib/task-photos";
import { attachReviewPhotos } from "@/lib/work-photos";
import { DbError, loadDeal, runCommand } from "@/lib/db/deals";
import { getDealForViewer } from "@/lib/deals/queries";
import { notifyChosen, runDispatch } from "@/lib/dispatch/run";
import { notify } from "@/lib/push";
import { EngineError, amountDue, categoryTrust, type Command } from "@/lib/engine";
import { workedTogether } from "@/lib/care";
import { getRules } from "@/lib/rules";
import { hadCareCall } from "@/lib/chat";
import { DISPUTE_REASONS, RATING_TAGS } from "@/lib/labels";
import { mockPaymentsEnabled, paymentProvider } from "@/lib/payments/provider";
import { activeProvider, afterPaymentBooked, paymentFor, startWirePayment } from "@/lib/payments/service";
import { markDirectPay, owedToHelper } from "@/lib/direct-pay";
import { headers } from "next/headers";
import { notifyPriceChange } from "@/lib/price-notify";
import { parsePrice } from "@/lib/price-input";
import { adminIds, getControls, isPausedError, payinBlock, type PayinBlock } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { fmtMoney } from "@/lib/format";

const DISPUTE_NOTE_MIN = 20;

/**
 * Every action on the task screen posts here with an `intent`. The engine decides whether the
 * viewer may do it; this only turns the form into an engine command and localises errors.
 */
export async function taskAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!isOnboarded(viewer.profile)) redirect("/onboarding"); // actions can be called directly: same rule as the pages
  const t = await getT();
  const db = createAdminClient();
  const dealId = String(form.get("dealId") ?? "");
  const intent = String(form.get("intent") ?? "");

  try {
    switch (intent) {
      case "direct_paid": {
        // fee-only task: the customer says they paid the helper directly
        const deal = await loadDeal(db, dealId);
        if (!deal || deal.type !== "errand" || deal.customerId !== viewer.profile.id) return { error: t("common.notFound") };
        if (!(await markDirectPay(deal, "customer_paid"))) return { error: t("error.changed") };
        if (deal.helperId) {
          await notify([deal.helperId], { title: "push.directPaidTitle", body: "push.directPaidBody", params: { title: deal.title, amount: fmtMoney(owedToHelper(deal)) }, url: `/jobs/${deal.id}`, tag: `job-${deal.id}` });
        }
        break;
      }
      case "pay": {
        // the real payment: wire.mn's checkout page — the full amount (managed service), a shopping
        // top-up, or an agreed higher price; older fee-only tasks pay just the fee
        if (activeProvider() !== "wire") return { error: t("error.generic") };
        const deal = await loadDeal(db, dealId);
        if (!deal || deal.type !== "errand" || deal.customerId !== viewer.profile.id) return { error: t("common.notFound") };
        const what = form.get("what") === "topup" ? "topup" : form.get("what") === "price" ? "price" : "first";
        const need = paymentFor(deal, what);
        if (!need) return { error: t("error.changed") };
        const blocked = await payinBlock(deal.id, viewer.profile.id, need.amount);
        if (blocked) return { error: await payinMessage(blocked, t) };
        const h = await headers();
        const origin = h.get("origin") ?? `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
        let url: string;
        try {
          url = await startWirePayment(deal, origin, what);
        } catch (e) {
          console.error("wire payment start failed", e);
          return { error: t("pay.unavailable") };
        }
        redirect(url);
      }
      case "simulate_payment": {
        // Stands in for the bank's webhook (CLAUDE.md §6). Exists only with the mock provider.
        if (!mockPaymentsEnabled()) return { error: t("error.generic") };
        const deal = await loadDeal(db, dealId);
        if (!deal || deal.type !== "errand" || deal.customerId !== viewer.profile.id) return { error: t("common.notFound") };
        const blocked = await payinBlock(deal.id, viewer.profile.id, amountDue(deal));
        if (blocked) return { error: await payinMessage(blocked, t) };
        const invoice = await paymentProvider().createInvoice(deal.id, amountDue(deal));
        const paid = await runCommand(db, deal.id, { type: "confirm_payment", providerRef: invoice.invoiceId, amount: invoice.amount }, { kind: "provider" });
        if (paid.deal.type === "errand") await afterPaymentBooked(paid.deal);
        // No refresh here: the pay sheet shows "held safely" first, then refreshes itself.
        return { done: true };
      }

      case "simulate_topup": {
        // Same as above for the over-budget top-up (docs/rules.md §Buy-for-me).
        if (!mockPaymentsEnabled()) return { error: t("error.generic") };
        const deal = await loadDeal(db, dealId);
        if (!deal || deal.type !== "errand" || deal.customerId !== viewer.profile.id) return { error: t("common.notFound") };
        if (deal.topUp?.status !== "pending") return { error: t("error.changed") };
        const blocked = await payinBlock(deal.id, viewer.profile.id, deal.topUp.amount);
        if (blocked) return { error: await payinMessage(blocked, t) };
        const invoice = await paymentProvider().createInvoice(deal.id, deal.topUp.amount, `topup-${deal.topUp.at}`);
        await runCommand(db, deal.id, { type: "confirm_topup", providerRef: invoice.invoiceId, amount: invoice.amount }, { kind: "provider" });
        return { done: true };
      }

      case "simulate_price_payment": {
        // The agreed higher price after matching: the customer pays the difference (mock bank).
        if (!mockPaymentsEnabled()) return { error: t("error.generic") };
        const deal = await loadDeal(db, dealId);
        if (!deal || deal.type !== "errand" || deal.customerId !== viewer.profile.id) return { error: t("common.notFound") };
        const pc = deal.priceChange;
        if (!pc || pc.status !== "awaiting_payment") return { error: t("error.changed") };
        const diff = pc.fee - deal.fee;
        const blocked = await payinBlock(deal.id, viewer.profile.id, diff);
        if (blocked) return { error: await payinMessage(blocked, t) };
        const invoice = await paymentProvider().createInvoice(deal.id, diff, `price-${pc.at}`);
        const r = await runCommand(db, deal.id, { type: "confirm_price", providerRef: invoice.invoiceId, amount: invoice.amount }, { kind: "provider" });
        if (r.deal.type === "errand" && r.deal.helperId) {
          await notify([r.deal.helperId], {
            title: "push.pricePaidTitle",
            body: "push.pricePaidBody",
            params: { fee: fmtMoney(r.deal.fee), title: r.deal.title },
            url: `/jobs/${deal.id}`,
            tag: `job-${deal.id}`,
          });
        }
        return { done: true };
      }

      case "rate": {
        const stars = Number(form.get("stars"));
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { error: t("error.generic") };
        const tags = form.getAll("tags").map(String).filter((x) => (RATING_TAGS as readonly string[]).includes(x));
        const { error } = await db.rpc("rate_deal", {
          p_deal_id: dealId,
          p_from: viewer.profile.id,
          p_stars: stars,
          p_tags: tags,
          p_note: String(form.get("note") ?? "").slice(0, 500),
        });
        if (error) return { error: error.code === "23505" ? t("error.changed") : t("error.generic") };
        // photos added while rating go public with the review (a failure never loses the rating)
        const reviewPhotos = parseOr(PhotoIdsJson, String(form.get("reviewPhotos") ?? "")) ?? [];
        if (reviewPhotos.length) await attachReviewPhotos(dealId, viewer.profile.id, reviewPhotos, stars).catch((e) => console.error("review photos failed", e));
        // care pilot: Ops looks at every care job a family rates below 4 stars
        if (stars < 4) {
          const rated = await loadDeal(db, dealId);
          if (rated?.type === "errand" && categoryTrust(rated.category) === "care" && viewer.profile.id === rated.customerId) {
            await notify(await adminIds(), {
              title: "push.careLowRatingTitle",
              body: "push.careLowRatingBody",
              params: { stars, title: rated.title },
              url: `/ops`,
              tag: `care-rating-${dealId}`,
            }).catch((e) => console.error("care rating alert failed", e));
          }
        }
        break;
      }

      default: {
        let cmd: Command;
        if (intent === "cancel") cmd = { type: "cancel" };
        else if (intent === "choose") cmd = { type: "choose", helperId: String(form.get("helperId") ?? "") };
        else if (intent === "answer_price") cmd = { type: "answer_price", accept: form.get("accept") === "1" };
        else if (intent === "withdraw_price") cmd = { type: "withdraw_price" };
        else if (intent === "open_to_all") cmd = { type: "open_to_all" };
        else if (intent === "counter" || intent === "set_price" || intent === "propose_price") {
          // bargaining (docs/decisions.md 2026-11-16): any price ≥ the minimum, ≤ what one task may hold
          const price = parsePrice(form.get("price"));
          if (price === null || price > (await getControls()).maxDealAmount) return { error: t("price.invalid") };
          cmd =
            intent === "counter"
              ? { type: "counter", helperId: String(form.get("helperId") ?? ""), price }
              : intent === "set_price"
                ? { type: "set_price", price }
                : { type: "propose_price", price };
        }
        else if (intent === "confirm") cmd = { type: "confirm" };
        else if (intent === "decline_topup") cmd = { type: "decline_topup" };
        else if (intent === "dispute") {
          const reason = String(form.get("reason") ?? "");
          const note = String(form.get("note") ?? "").trim();
          if (!(DISPUTE_REASONS as readonly string[]).includes(reason)) return { error: t("error.generic") };
          if (note.length < DISPUTE_NOTE_MIN) return { error: t("dispute.noteShort") };
          cmd = { type: "dispute", reason, note };
        } else return { error: t("error.generic") };
        // care work (children, patients): talk first — a real call with that person before choosing them
        if (cmd.type === "choose") {
          const before = await loadDeal(db, dealId);
          // "talk first" as a condition on any task: the same call rule (the database checks it too)
          if (before?.type === "errand" && categoryTrust(before.category) !== "care" && before.details.require?.call) {
            if (!(await hadCareCall(dealId, cmd.helperId))) return { error: t("conditions.callFirst", { seconds: (await getRules()).careCallMinSeconds }) };
          }
          if (before?.type === "errand" && categoryTrust(before.category) === "care") {
            if (!(await hadCareCall(dealId, cmd.helperId))) return { error: t("care.callFirst", { seconds: (await getRules()).careCallMinSeconds }) };
            // meet first: with a new sitter, a parent / family member stays at home for this session
            const known = await workedTogether(before.customerId, [cmd.helperId]);
            if (!known.has(cmd.helperId) && form.get("familyHome") !== "on") return { error: t("care.meetFirstNeeded") };
          }
        }
        const r = await runCommand(db, dealId, cmd, viewer.actor);
        if (cmd.type === "choose" && r.deal.type === "errand") {
          await notifyChosen(r.deal, false);
          await runDispatch(dealId);
        }
        if (cmd.type === "open_to_all") await runDispatch(dealId); // the first wave goes out now
        if ((cmd.type === "propose_price" || cmd.type === "answer_price") && r.deal.type === "errand" && r.deal.helperId) {
          await notifyPriceChange(r.deal, cmd, viewer.profile.name || "—", r.deal.helperId, `/jobs/${dealId}`);
        }
        if (cmd.type === "counter" && r.deal.type === "errand") {
          await notify([cmd.helperId], {
            title: "push.counterTitle",
            body: "push.counterBody",
            params: { fee: fmtMoney(cmd.price), title: r.deal.title },
            url: `/jobs/${dealId}`,
            tag: `job-${dealId}`,
          });
        }
      }
    }
  } catch (e) {
    if (e instanceof EngineError) {
      refresh();
      const min = /Minimum fee is ₮(\d+)/.exec(e.message);
      if (min) return { error: t("post.reason.fee", { amount: fmtMoney(Number(min[1])) }) };
      const over = /Job total is over ₮(\d+)/.exec(e.message);
      if (over) return { error: t("post.reason.overMax", { amount: fmtMoney(Number(over[1])) }) };
      if (/Waiting for the helper/.test(e.message)) return { error: t("price.waitingHelper") };
      return { error: e.code === "FORBIDDEN" ? t("error.forbidden") : t("error.changed") };
    }
    if (isPausedError(e)) return { error: t("safety.moneyFrozen") };
    if (e instanceof DbError) return { error: t("error.generic") };
    throw e;
  }

  refresh();
  return { done: true };
}

/** Why a payment can't start right now, in the customer's words. Nothing has been charged. */
async function payinMessage(reason: PayinBlock, t: Awaited<ReturnType<typeof getT>>): Promise<string> {
  if (reason === "payments_paused") return t("safety.paymentsPaused");
  if (reason === "cap_total") return t("safety.capTotal");
  const c = await getControls();
  return reason === "cap_deal"
    ? t("safety.capDeal", { amount: fmtMoney(c.maxDealAmount) })
    : t("safety.capDaily", { amount: fmtMoney(c.maxCustomerDaily) });
}

/**
 * Polled from the customer's task screen while it is live: settles anything due (payment window,
 * expiry) and advances the dispatch waves. Cheap and idempotent; the cron tick does the same.
 */
export async function pokeTask(dealId: string): Promise<void> {
  const viewer = await getViewer();
  if (!viewer || !parseOr(Uuid, dealId)) return;
  const deal = await getDealForViewer(dealId, viewer); // settles due commands
  if (deal?.type === "errand" && deal.customerId === viewer.profile.id && deal.status === "open") {
    await runDispatch(deal.id);
  }
}

/* ---------- the customer's own task photos, while the task is open ---------- */

export async function removeTaskPhotoAction(dealId: string, photoId: string): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (!/^[0-9a-f-]{36}$/i.test(dealId) || !/^[0-9a-f-]{36}$/i.test(photoId)) return { error: t("error.generic") };
  if (!(await removeTaskPhoto(photoId, dealId, viewer.profile.id))) return { error: t("taskPhotos.locked") };
  refresh();
  return {};
}

/** Attach freshly uploaded photos (from prepareTaskPhoto) to the customer's open task; at most 5 in all. */
export async function addTaskPhotosAction(dealId: string, ids: string[]): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  const parsed = parseOr(PhotoIdsJson, JSON.stringify(Array.isArray(ids) ? ids : []));
  if (!/^[0-9a-f-]{36}$/i.test(dealId) || !parsed) return { error: t("error.generic") };
  if (!(await photosEditable(dealId, viewer.profile.id))) return { error: t("taskPhotos.locked") };
  try {
    await attachTaskPhotos(dealId, viewer.profile.id, parsed);
  } catch {
    return { error: t("taskPhotos.full") }; // the database allows at most 5 per task
  }
  refresh();
  return {};
}
