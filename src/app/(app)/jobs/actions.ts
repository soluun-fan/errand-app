"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { DbError, runCommand } from "@/lib/db/deals";
import { MAX_PENDING_APPLICATIONS, pendingApplications } from "@/lib/dispatch/rank";
import { runDispatch } from "@/lib/dispatch/run";
import { EngineError, type Command } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";
import { notify, removeSubscription, saveSubscription, type BrowserSubscription } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";

const RADII = [1, 3, 5, 10, 15, 60] as const;

async function helperViewer() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

const coord = (v: FormDataEntryValue | null, lim: number) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) && Math.abs(n) <= lim ? n : null;
};

/** Online / offline + radius (+ position if the browser gave one). Approved helpers only. */
export async function setPresence(form: FormData): Promise<void> {
  const viewer = await helperViewer();
  if (!viewer.actor.helperApproved) return;
  const radius = Number(form.get("radius"));
  const row: Record<string, unknown> = {
    user_id: viewer.profile.id,
    online: form.get("online") === "on",
    updated_at: new Date().toISOString(),
  };
  if ((RADII as readonly number[]).includes(radius)) row.radius_km = radius;
  const lat = coord(form.get("lat"), 90);
  const lng = coord(form.get("lng"), 180);
  if (lat !== null && lng !== null) Object.assign(row, { lat, lng });
  await createAdminClient().from("helper_presence").upsert(row).throwOnError();
  refresh();
}

/** Position heartbeat while online (the client sends it at most once a minute). */
export async function heartbeat(lat: number, lng: number): Promise<void> {
  const viewer = await helperViewer();
  if (!viewer.actor.helperApproved || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  await createAdminClient()
    .from("helper_presence")
    .update({ lat, lng, updated_at: new Date().toISOString() })
    .eq("user_id", viewer.profile.id)
    .eq("online", true);
}

export async function savePush(sub: BrowserSubscription): Promise<void> {
  const viewer = await helperViewer();
  await saveSubscription(viewer.profile.id, sub, await getLocale());
}

export async function removePush(endpoint: string): Promise<void> {
  const viewer = await helperViewer();
  await removeSubscription(viewer.profile.id, endpoint);
}

/**
 * Helper-side task actions: apply ("Хийж чадна", Instant) or quote (Custom) — the customer chooses —
 * take back an application, step back before payment, start, skip an offer.
 */
export async function jobAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await helperViewer();
  const t = await getT();
  const db = createAdminClient();
  const dealId = String(form.get("dealId") ?? "");
  const intent = String(form.get("intent") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) return { error: t("common.notFound") };

  try {
    if (intent === "skip") {
      await db
        .from("dispatch_offers")
        .update({ status: "declined" })
        .eq("deal_id", dealId)
        .eq("helper_id", viewer.profile.id)
        .eq("status", "sent");
      refresh();
      return { done: true };
    }

    if ((intent === "apply" || intent === "quote") && (await pendingApplications(viewer.profile.id)) >= MAX_PENDING_APPLICATIONS) {
      return { error: t("job.tooMany", { n: MAX_PENDING_APPLICATIONS }) };
    }
    let cmd: Command;
    const note = String(form.get("note") ?? "").slice(0, 300);
    if (intent === "apply") cmd = { type: "apply", note };
    else if (intent === "quote") {
      const price = Number(String(form.get("price") ?? "").replace(/[^\d]/g, ""));
      if (!Number.isInteger(price) || price <= 0) return { error: t("job.quoteInvalid") };
      cmd = { type: "apply", note, price };
    } else if (intent === "unapply") cmd = { type: "withdraw_offer" };
    else if (intent === "withdraw") cmd = { type: "cancel" };
    else if (intent === "start") cmd = { type: "start" };
    else return { error: t("error.generic") };

    const { deal } = await runCommand(db, dealId, cmd, viewer.actor);
    if (deal.type !== "errand") return { error: t("error.generic") };

    if (intent === "apply") {
      await notify([deal.customerId], {
        title: "push.applicantTitle",
        body: "push.applicantBody",
        params: { name: viewer.profile.name || "—", title: deal.title },
        url: `/tasks/${dealId}`,
        tag: `task-${dealId}`,
      });
    } else if (intent === "quote") {
      await notify([deal.customerId], {
        title: "push.quoteTitle",
        body: "push.quoteBody",
        params: { name: viewer.profile.name || "—", fee: fmtMoney(cmd.type === "apply" ? (cmd.price ?? deal.fee) : deal.fee) },
        url: `/tasks/${dealId}`,
        tag: `task-${dealId}`,
      });
    } else if (intent === "withdraw") {
      await runDispatch(dealId); // back to searching
    }
  } catch (e) {
    if (e instanceof EngineError) {
      refresh();
      if (e.code === "FORBIDDEN") return { error: t("error.forbidden") };
      if (/Minimum fee/.test(e.message)) return { error: t("job.quoteInvalid") };
      if (/applicants/.test(e.message)) return { error: t("job.full") };
      return { error: intent === "apply" || intent === "quote" ? t("job.taken") : t("error.changed") };
    }
    if (e instanceof DbError) return { error: t("error.changed") };
    throw e;
  }
  refresh();
  return { done: true };
}
