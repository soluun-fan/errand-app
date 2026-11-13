"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { DbError, loadDeal, runCommand } from "@/lib/db/deals";
import { getDealForViewer } from "@/lib/deals/queries";
import { runDispatch } from "@/lib/dispatch/run";
import { notify } from "@/lib/push";
import { EngineError, amountDue, type Command } from "@/lib/engine";
import { DISPUTE_REASONS, RATING_TAGS } from "@/lib/labels";
import { mockPaymentsEnabled, paymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";

const DISPUTE_NOTE_MIN = 20;

/**
 * Every action on the task screen posts here with an `intent`. The engine decides whether the
 * viewer may do it; this only turns the form into an engine command and localises errors.
 */
export async function taskAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  const db = createAdminClient();
  const dealId = String(form.get("dealId") ?? "");
  const intent = String(form.get("intent") ?? "");

  try {
    switch (intent) {
      case "simulate_payment": {
        // Stands in for the bank's webhook (CLAUDE.md §6). Exists only with the mock provider.
        if (!mockPaymentsEnabled()) return { error: t("error.generic") };
        const deal = await loadDeal(db, dealId);
        if (!deal || deal.type !== "errand" || deal.customerId !== viewer.profile.id) return { error: t("common.notFound") };
        const invoice = await paymentProvider().createInvoice(deal.id, amountDue(deal));
        const paid = await runCommand(db, deal.id, { type: "confirm_payment", providerRef: invoice.invoiceId, amount: invoice.amount }, { kind: "provider" });
        if (paid.deal.type === "errand" && paid.deal.helperId) {
          await notify([paid.deal.helperId], {
            title: "push.paidTitle",
            body: "push.paidBody",
            params: { title: paid.deal.title },
            url: `/jobs/${deal.id}`,
            tag: `job-${deal.id}`,
          });
        }
        // No refresh here: the pay sheet shows "held safely" first, then refreshes itself.
        return { done: true };
      }

      case "simulate_topup": {
        // Same as above for the over-budget top-up (docs/rules.md §Buy-for-me).
        if (!mockPaymentsEnabled()) return { error: t("error.generic") };
        const deal = await loadDeal(db, dealId);
        if (!deal || deal.type !== "errand" || deal.customerId !== viewer.profile.id) return { error: t("common.notFound") };
        if (deal.topUp?.status !== "pending") return { error: t("error.changed") };
        const invoice = await paymentProvider().createInvoice(deal.id, deal.topUp.amount, `topup-${deal.topUp.at}`);
        await runCommand(db, deal.id, { type: "confirm_topup", providerRef: invoice.invoiceId, amount: invoice.amount }, { kind: "provider" });
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
        break;
      }

      default: {
        let cmd: Command;
        if (intent === "cancel") cmd = { type: "cancel" };
        else if (intent === "choose") cmd = { type: "choose", helperId: String(form.get("helperId") ?? "") };
        else if (intent === "confirm") cmd = { type: "confirm" };
        else if (intent === "decline_topup") cmd = { type: "decline_topup" };
        else if (intent === "dispute") {
          const reason = String(form.get("reason") ?? "");
          const note = String(form.get("note") ?? "").trim();
          if (!(DISPUTE_REASONS as readonly string[]).includes(reason)) return { error: t("error.generic") };
          if (note.length < DISPUTE_NOTE_MIN) return { error: t("dispute.noteShort") };
          cmd = { type: "dispute", reason, note };
        } else return { error: t("error.generic") };
        await runCommand(db, dealId, cmd, viewer.actor);
      }
    }
  } catch (e) {
    if (e instanceof EngineError) {
      refresh();
      return { error: e.code === "FORBIDDEN" ? t("error.forbidden") : t("error.changed") };
    }
    if (e instanceof DbError) return { error: t("error.generic") };
    throw e;
  }

  refresh();
  return { done: true };
}

/**
 * Polled from the customer's task screen while it is live: settles anything due (payment window,
 * expiry) and advances the dispatch waves. Cheap and idempotent; the cron tick does the same.
 */
export async function pokeTask(dealId: string): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) return;
  const deal = await getDealForViewer(dealId, viewer); // settles due commands
  if (deal?.type === "errand" && deal.customerId === viewer.profile.id && deal.status === "open") {
    await runDispatch(deal.id);
  }
}
