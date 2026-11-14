"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { DbError, loadDeal, runCommand } from "@/lib/db/deals";
import { isPausedError } from "@/lib/safety";
import { MAX_PENDING_APPLICATIONS, pendingApplications } from "@/lib/dispatch/rank";
import { runDispatch } from "@/lib/dispatch/run";
import { EngineError, counterMaxFor, type Command } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";
import { MAX_PROOF_BYTES, PROOF_MIME, createUploadSlot, recordProof, type ProofKind, type UploadSlot } from "@/lib/proofs";
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

/**
 * Live position during a job (matched / in progress), even if the helper went "offline" for new
 * work — the customer of that task sees where their helper is. Only the assigned helper can send.
 */
export async function trackJob(dealId: string, lat: number, lng: number): Promise<void> {
  const viewer = await helperViewer();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  const db = createAdminClient();
  const { data } = await db.from("deals").select("helper_id, status").eq("id", dealId).maybeSingle<{ helper_id: string | null; status: string }>();
  if (!data || data.helper_id !== viewer.profile.id || !["matched", "in_progress"].includes(data.status)) return;
  await db
    .from("helper_presence")
    .upsert({ user_id: viewer.profile.id, lat, lng, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

/* ---------- proof upload (docs/rules.md §Proof) ---------- */

async function assignedInProgress(dealId: string, helperId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) return null;
  const deal = await loadDeal(createAdminClient(), dealId);
  return deal?.type === "errand" && deal.helperId === helperId && deal.status === "in_progress" ? deal : null;
}

/** Step 1: a signed upload URL for one file — only for the assigned helper of a task in progress. */
export async function prepareProof(dealId: string, kind: ProofKind, mime: string, bytes: number): Promise<UploadSlot | { error: string }> {
  const viewer = await helperViewer();
  const t = await getT();
  if (!(await assignedInProgress(dealId, viewer.profile.id))) return { error: t("error.changed") };
  if (!(PROOF_MIME as readonly string[]).includes(mime) || (kind === "receipt" && !mime.startsWith("image/"))) return { error: t("proof.badType") };
  if (!(bytes > 0 && bytes <= MAX_PROOF_BYTES)) return { error: t("proof.tooBig") };
  return createUploadSlot(dealId, kind, mime);
}

export interface ProofSubmit {
  dealId: string;
  kind: ProofKind;
  path: string;
  mime: string;
  bytes: number;
  sha256: string | null;
  dhash: string | null;
  amount: number | null;
  lat: number | null;
  lng: number | null;
  takenAt: number | null;
}

/** Step 2 (after the browser uploaded): record the proof, then tell the engine (receipt / handover). */
export async function submitProof(p: ProofSubmit): Promise<{ error?: string; flags?: string[] }> {
  const viewer = await helperViewer();
  const t = await getT();
  const deal = await assignedInProgress(p.dealId, viewer.profile.id);
  if (!deal) return { error: t("error.changed") };
  const amount = p.kind === "receipt" ? Number(p.amount) : null;
  if (p.kind === "receipt" && !(Number.isSafeInteger(amount) && (amount as number) > 0)) return { error: t("proof.amountNeeded") };
  const clean = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v) ? v : null);
  try {
    const flags = await recordProof({
      dealId: p.dealId,
      kind: p.kind,
      path: String(p.path),
      mime: String(p.mime),
      bytes: Number(p.bytes),
      sha256: clean(p.sha256, /^[0-9a-f]{64}$/),
      dhash: clean(p.dhash, /^[0-9a-f]{16}$/),
      amount,
      lat: Number.isFinite(p.lat) ? p.lat : null,
      lng: Number.isFinite(p.lng) ? p.lng : null,
      takenAt: Number.isFinite(p.takenAt) ? p.takenAt : null,
      uploadedBy: viewer.profile.id,
    });
    const cmd: Command = p.kind === "receipt" ? { type: "record_receipt", amount: amount as number } : { type: "record_handover" };
    const r = await runCommand(createAdminClient(), p.dealId, cmd, viewer.actor);
    if (r.deal.type === "errand" && r.deal.topUp?.status === "pending") {
      await notify([r.deal.customerId], {
        title: "push.topUpTitle",
        body: "push.topUpBody",
        params: { amount: fmtMoney(r.deal.topUp.amount) },
        url: `/tasks/${p.dealId}`,
        tag: `task-${p.dealId}`,
      });
    }
    refresh();
    return { flags };
  } catch (e) {
    if (e instanceof EngineError) return { error: t("error.changed") };
    console.error("proof failed", e);
    return { error: t("proof.failed") };
  }
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
 * Helper-side task actions: apply (take the customer's price) or quote (counter once, higher) — the customer chooses —
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
      const current = await loadDeal(db, dealId);
      if (!current || current.type !== "errand") return { error: t("error.changed") };
      const cap = current.details.counterMax > 0 ? current.details.counterMax : counterMaxFor(current.postedFee);
      if (!Number.isInteger(price) || price <= current.postedFee || price > cap) {
        return { error: t("price.counterRange", { min: fmtMoney(current.postedFee), max: fmtMoney(cap) }) };
      }
      cmd = { type: "apply", note, price };
    } else if (intent === "unapply") cmd = { type: "withdraw_offer" };
    else if (intent === "withdraw") cmd = { type: "cancel" };
    else if (intent === "start") cmd = { type: "start" };
    else if (intent === "finish") cmd = { type: "finish" };
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
    } else if (intent === "finish") {
      await notify([deal.customerId], {
        title: "push.doneTitle",
        body: "push.doneBody",
        params: { title: deal.title, hours: deal.checkHours },
        url: `/tasks/${dealId}`,
        tag: `task-${dealId}`,
      });
    }
  } catch (e) {
    if (e instanceof EngineError) {
      refresh();
      if (e.code === "FORBIDDEN") return { error: t("error.forbidden") };
      if (/Minimum fee/.test(e.message)) return { error: t("job.quoteInvalid") };
      if (e.code === "PROOF_MISSING") return { error: t("proof.missing") };
      if (/approve the extra/.test(e.message)) return { error: t("proof.waitTopUp") };
      if (/applicants/.test(e.message)) return { error: t("job.full") };
      return { error: intent === "apply" || intent === "quote" ? t("job.taken") : t("error.changed") };
    }
    if (isPausedError(e)) return { error: t("safety.moneyFrozen") };
    if (e instanceof DbError) return { error: t("error.changed") };
    throw e;
  }
  refresh();
  return { done: true };
}
