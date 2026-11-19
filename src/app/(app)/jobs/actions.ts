"use server";

import { refresh } from "next/cache";
import { isOnboarded } from "@/lib/legal-rules";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { DbError, loadDeal, runCommand } from "@/lib/db/deals";
import { parsePrice } from "@/lib/price-input";
import { notifyPriceChange } from "@/lib/price-notify";
import { getControls, isPausedError } from "@/lib/safety";
import { MAX_PENDING_APPLICATIONS, pendingApplications } from "@/lib/dispatch/rank";
import { restartDispatch, runDispatch } from "@/lib/dispatch/run";
import { runRefunds } from "@/lib/payments/service";
import { markDirectPay, owedToHelper } from "@/lib/direct-pay";
import { checkHandoverCode } from "@/lib/handover-code";
import { isActiveTestHelper } from "@/lib/helper-test-mode";
import { hasPayout } from "@/lib/payout";
import { workReadyMissing } from "@/lib/work-ready";
import { LEGAL_VERSIONS } from "@/lib/legal-rules";
import { OPS_ALERT_AT, pauseDaysFor, recentBackOuts } from "@/lib/penalties";
import { getRules } from "@/lib/rules";
import { adminIds } from "@/lib/safety";
import { EngineError, OPEN_CATEGORIES, categoryTrust, minFeeAt, ruleOf, type CategoryId, type Command, type Deal, type ErrandDeal } from "@/lib/engine";
import { hadCareCall } from "@/lib/chat";
import { maskContacts } from "@/lib/chat-rules";
import { pricingConfig } from "@/lib/pricing";
import { fmtMoney } from "@/lib/format";
import { MAX_PROGRESS_PROOFS, MAX_PROOF_BYTES, PROOF_MIME, createUploadSlot, proofCount, recordProof, removeProof, type ProofKind, type UploadSlot } from "@/lib/proofs";
import { notify, removeSubscription, saveSubscription, type BrowserSubscription } from "@/lib/push";
import { LatLng, ProofKindInput, ProofSubmitInput, PushSubscriptionInput, Uuid, parseOr } from "@/lib/input";
import { createAdminClient } from "@/lib/supabase/admin";

const RADII = [1, 3, 5, 10, 15, 60] as const;

async function helperViewer() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!isOnboarded(viewer.profile)) redirect("/onboarding"); // actions can be called directly: same rule as the pages
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
  // no bank account, no work: going online waits until there is one
  if (form.get("online") === "on" && !isActiveTestHelper(viewer.profile) && !(await hasPayout(viewer.profile.id))) redirect("/helper/bank");
  // a phone with notifications and location on (the position comes with this request)
  if (form.get("online") === "on") {
    const hasPos = coord(form.get("lat"), 90) !== null && coord(form.get("lng"), 180) !== null;
    const missing = (await workReadyMissing(viewer.profile)).filter((s) => !(s === "location" && hasPos));
    if (missing.length) return; // the page shows the checklist; nothing goes online
  }
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

/** The helper's position when they turn location on (work-ready check), online or not. */
export async function reportPosition(rawLat: number, rawLng: number): Promise<void> {
  const viewer = await helperViewer();
  const pos = parseOr(LatLng, { lat: rawLat, lng: rawLng });
  if (!viewer.actor.helperApproved || !pos) return;
  await createAdminClient()
    .from("helper_presence")
    .upsert({ user_id: viewer.profile.id, lat: pos.lat, lng: pos.lng, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

/** Position heartbeat while online (the client sends it at most once a minute). */
export async function heartbeat(rawLat: number, rawLng: number): Promise<void> {
  const viewer = await helperViewer();
  const pos = parseOr(LatLng, { lat: rawLat, lng: rawLng });
  if (!viewer.actor.helperApproved || !pos) return;
  const { lat, lng } = pos;
  await createAdminClient()
    .from("helper_presence")
    .update({ lat, lng, updated_at: new Date().toISOString() })
    .eq("user_id", viewer.profile.id)
    .eq("online", true);
}

export async function setJobLocationSharing(dealId: string, enabled: boolean): Promise<boolean> {
  const viewer = await helperViewer();
  if (!parseOr(Uuid, dealId) || typeof enabled !== "boolean") return false;
  const { data } = await createAdminClient().rpc("set_job_location_sharing", {
    p_deal: dealId, p_helper: viewer.profile.id, p_enabled: enabled,
  }).throwOnError();
  return data === true;
}

export async function trackJob(dealId: string, rawLat: number, rawLng: number): Promise<void> {
  const viewer = await helperViewer();
  const pos = parseOr(LatLng, { lat: rawLat, lng: rawLng });
  if (!pos || !parseOr(Uuid, dealId)) return;
  // Updates can only touch an existing opt-in. A delayed sample cannot restart sharing.
  await createAdminClient().from("job_locations").update({ ...pos, updated_at: new Date().toISOString() })
    .eq("deal_id", dealId).eq("helper_id", viewer.profile.id).throwOnError();
}

/* ---------- proof upload (docs/rules.md §Proof) ---------- */

/**
 * The assigned helper's task, in the state this kind of photo is taken in: the start photo while
 * matched (taking it starts the job), everything else while in progress.
 */
async function assignedFor(dealId: string, helperId: string, kind: ProofKind) {
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) return null;
  const deal = await loadDeal(createAdminClient(), dealId);
  if (deal?.type !== "errand" || deal.helperId !== helperId) return null;
  return deal.status === (kind === "start" ? "matched" : "in_progress") ? deal : null;
}

/** Care work: no start photo (no pictures of children or elders); the start button works as before. */
const needsStartPhoto = (category: CategoryId) => categoryTrust(category) !== "care";

/** Step 1: a signed upload URL for one file — only for the assigned helper, at the right moment. */
export async function prepareProof(dealId: string, rawKind: ProofKind, mime: string, bytes: number): Promise<UploadSlot | { error: string }> {
  const viewer = await helperViewer();
  const t = await getT();
  // `kind` becomes part of the storage path: only the two known kinds, never free text
  const kind = parseOr(ProofKindInput, rawKind);
  if (!kind || typeof mime !== "string" || typeof bytes !== "number") return { error: t("proof.badType") };
  const deal = await assignedFor(dealId, viewer.profile.id, kind);
  if (!deal) return { error: t("error.changed") };
  const photoOnly = kind === "receipt" || kind === "start";
  if (!(PROOF_MIME as readonly string[]).includes(mime) || (photoOnly && !mime.startsWith("image/"))) return { error: t("proof.badType") };
  if (!(bytes > 0 && bytes <= MAX_PROOF_BYTES)) return { error: t("proof.tooBig") };
  if (kind === "progress" && (await proofCount(dealId, "progress")) >= MAX_PROGRESS_PROOFS) return { error: t("proof.progressFull", { n: MAX_PROGRESS_PROOFS }) };
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
  note?: string | null;
}

/**
 * Step 2 (after the browser uploaded): record the proof, then tell the engine — receipt, handover,
 * or start (the start photo starts the job). Progress photos only tell the customer.
 */
export async function submitProof(raw: ProofSubmit): Promise<{ error?: string; flags?: string[] }> {
  const viewer = await helperViewer();
  const t = await getT();
  const p = parseOr(ProofSubmitInput, raw);
  if (!p) return { error: t("proof.failed") };
  // the start photo starts the job: the same phone / notifications / location check as "start"
  if (p.kind === "start") {
    const missing = await workReadyMissing(viewer.profile);
    if (missing.length) return { error: t("workReady.blocked", { steps: missing.map((s) => t(`workReady.short.${s}`)).join(", ") }) };
  }
  const deal = await assignedFor(p.dealId, viewer.profile.id, p.kind);
  if (!deal) return { error: t("error.changed") };
  if (p.kind === "progress" && (await proofCount(p.dealId, "progress")) >= MAX_PROGRESS_PROOFS) return { error: t("proof.progressFull", { n: MAX_PROGRESS_PROOFS }) };
  const note = p.kind === "progress" ? (p.note ?? "").replace(/\s+/g, " ").trim().slice(0, 140) || null : null;
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
      note: note === null ? null : maskContacts(note).text,
    });
    if (p.kind === "progress" || p.kind === "start") {
      if (p.kind === "start") await runCommand(createAdminClient(), p.dealId, { type: "start" }, viewer.actor);
      await notify([deal.customerId], {
        title: p.kind === "start" ? "push.startedTitle" : "push.photoTitle",
        body: p.kind === "start" ? "push.startedBody" : "push.photoBody",
        params: { name: viewer.profile.name || "—", title: deal.title },
        url: `/tasks/${p.dealId}`,
        tag: `task-${p.dealId}`,
      });
      refresh();
      return { flags };
    }
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

export async function savePush(raw: BrowserSubscription): Promise<void> {
  const viewer = await helperViewer();
  const sub = parseOr(PushSubscriptionInput, raw);
  if (!sub) return;
  await saveSubscription(viewer.profile.id, sub, await getLocale());
}

export async function removePush(endpoint: string): Promise<void> {
  const viewer = await helperViewer();
  if (typeof endpoint !== "string" || endpoint.length > 1000) return;
  await removeSubscription(viewer.profile.id, endpoint);
}

/**
 * Helper-side task actions (docs/decisions.md 2026-11-16 "Bargaining"): apply (take the customer's
 * price) or quote (name your own), re-price your offer, accept the customer's counter-price, take
 * back an application, step back before payment, start, finish, skip an offer.
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

    if (intent === "direct_received" || intent === "direct_unpaid") {
      // fee-only task: the helper confirms they were paid — or reports they weren't (Ops follows up)
      const d = await loadDeal(db, dealId);
      if (d?.type !== "errand" || d.helperId !== viewer.profile.id) return { error: t("error.forbidden") };
      if (!(await markDirectPay(d, intent === "direct_received" ? "helper_received" : "unpaid_reported"))) return { error: t("error.changed") };
      if (intent === "direct_unpaid") {
        await notify(await adminIds(), { title: "push.unpaidOpsTitle", body: "push.unpaidOpsBody", params: { title: d.title, amount: fmtMoney(owedToHelper(d)) }, url: `/ops/payments`, tag: `unpaid-${d.id}` }).catch(() => undefined);
        await notify([d.customerId], { title: "push.unpaidCustomerTitle", body: "push.unpaidCustomerBody", params: { title: d.title, amount: fmtMoney(owedToHelper(d)) }, url: `/tasks/${d.id}`, tag: `task-${d.id}` }).catch(() => undefined);
      }
      refresh();
      return { done: true };
    }
    // a phone with notifications and location on — applying, taking a price, starting
    if (["apply", "quote", "add_kind_apply", "accept_counter", "start"].includes(intent)) {
      // the current Helper service agreement must be accepted (asked again when it changes)
      if (viewer.profile.helper_terms_version !== LEGAL_VERSIONS.helper) return { error: t("workReady.terms") };
      const missing = await workReadyMissing(viewer.profile);
      if (missing.length) return { error: t("workReady.blocked", { steps: missing.map((s) => t(`workReady.short.${s}`)).join(", ") }) };
    }
    // no bank account, no work (the database refuses it too)
    if ((intent === "apply" || intent === "quote" || intent === "add_kind_apply") && !(await hasPayout(viewer.profile.id))) {
      const pilot = isActiveTestHelper(viewer.profile);
      const target = pilot ? await loadDeal(db, dealId) : null;
      if (target?.type !== "errand" || target.payMode !== "held") return { error: t("payout.needed") };
    }
    if ((intent === "apply" || intent === "quote" || intent === "add_kind_apply") && (await pendingApplications(viewer.profile.id)) >= MAX_PENDING_APPLICATIONS) {
      return { error: t("job.tooMany", { n: MAX_PENDING_APPLICATIONS }) };
    }
    let cmd: Command;
    const note = String(form.get("note") ?? "").slice(0, 300);
    // a named price: any amount ≥ the minimum (engine), at most what one task may hold (safety cap)
    const named = async () => {
      const price = parsePrice(form.get("price"));
      if (price === null) return null;
      return price <= (await getControls()).maxDealAmount ? price : null;
    };
    let actor = viewer.actor;
    if (intent === "add_kind_apply") {
      // an everyday kind the helper hadn't picked: add it to their work kinds, then apply
      const target = await loadDeal(db, dealId);
      if (target?.type !== "errand" || !OPEN_CATEGORIES.includes(target.category) || !viewer.actor.helperApproved) return { error: t("error.forbidden") };
      const kinds = [...new Set([...(viewer.actor.categories ?? []), target.category])];
      await db.from("profiles").update({ categories: kinds }).eq("id", viewer.profile.id).eq("role", "helper").throwOnError();
      actor = { ...viewer.actor, categories: kinds };
      cmd = { type: "apply", note };
    } else if (intent === "apply") cmd = { type: "apply", note };
    else if (intent === "quote" || intent === "reprice") {
      const price = await named();
      if (price === null) return { error: t("job.quoteInvalid", { amount: fmtMoney(await taskFloor(dealId)) }) };
      cmd = intent === "quote" ? { type: "apply", note, price } : { type: "reprice", price };
    } else if (intent === "accept_counter") cmd = { type: "accept_counter" };
    else if (intent === "propose_price") {
      const price = await named();
      if (price === null) return { error: t("job.quoteInvalid", { amount: fmtMoney(await taskFloor(dealId)) }) };
      cmd = { type: "propose_price", price };
    } else if (intent === "answer_price") cmd = { type: "answer_price", accept: form.get("accept") === "1" };
    else if (intent === "withdraw_price") cmd = { type: "withdraw_price" };
    else if (intent === "unapply") cmd = { type: "withdraw_offer" };
    else if (intent === "decline_invite") cmd = { type: "decline_invite" };
    else if (intent === "withdraw") cmd = { type: "cancel" };
    else if (intent === "start") {
      // the start photo starts the job (submitProof); the plain button is only for care work
      const before = await loadDeal(db, dealId);
      if (before?.type === "errand" && needsStartPhoto(before.category) && (await proofCount(dealId, "start", viewer.profile.id)) === 0) return { error: t("proof.startNeeded") };
      cmd = { type: "start" };
    }
    else if (intent === "finish") {
      // a handover photo (or care check-out) that is still there — one taken back doesn't count
      if ((await proofCount(dealId, "handover", viewer.profile.id)) === 0) return { error: t("proof.missing") };
      // handover code condition: the customer's 4 digits (the database refuses "done" without it too)
      const target = await loadDeal(db, dealId);
      if (target?.type === "errand" && target.details.require?.handoverCode && target.helperId === viewer.profile.id) {
        const r = await checkHandoverCode(dealId, viewer.profile.id, String(form.get("code") ?? "").trim());
        if (r === "wrong") return { error: t("conditions.codeWrong") };
        if (r === "locked") return { error: t("conditions.codeLocked") };
        if (r === "missing") return { error: t("error.generic") };
      }
      cmd = { type: "finish" };
    }
    else return { error: t("error.generic") };

    // care work: the customer must have talked to this helper before they're matched (also for accepting the customer's price)
    if (cmd.type === "accept_counter") {
      const before = await loadDeal(db, dealId);
      if (before?.type === "errand" && categoryTrust(before.category) === "care" && !(await hadCareCall(dealId, viewer.profile.id))) {
        return { error: t("care.callFirstHelper") };
      }
    }
    const before = cmd.type === "cancel" ? await loadDeal(db, dealId) : null;
    const { deal } = await runCommand(db, dealId, cmd, actor);
    if (deal.type !== "errand") return { error: t("error.generic") };

    if (intent === "apply" || intent === "add_kind_apply") {
      await notify([deal.customerId], {
        title: "push.applicantTitle",
        body: "push.applicantBody",
        params: { name: viewer.profile.name || "—", title: deal.title },
        url: `/tasks/${dealId}`,
        tag: `task-${dealId}`,
      });
    } else if (intent === "quote" || intent === "reprice" || (intent === "accept_counter" && deal.status === "open")) {
      await notify([deal.customerId], {
        title: "push.quoteTitle",
        body: "push.quoteBody",
        params: { name: viewer.profile.name || "—", fee: fmtMoney(cmd.type === "apply" || cmd.type === "reprice" ? (cmd.price ?? deal.fee) : (deal.offers.find((o) => o.helperId === viewer.profile.id)?.price ?? deal.fee)) },
        url: `/tasks/${dealId}`,
        tag: `task-${dealId}`,
      });
    } else if (cmd.type === "propose_price" || cmd.type === "answer_price") {
      await notifyPriceChange(deal, cmd, viewer.profile.name || "—", deal.customerId, `/tasks/${dealId}`);
    } else if (intent === "accept_counter") {
      await notify([deal.customerId], {
        title: "push.counterAcceptedTitle",
        body: deal.payMode === "direct" ? "push.acceptedDirectBody" : "push.acceptedBody",
        params: { name: viewer.profile.name || "—", fee: fmtMoney(deal.fee), minutes: ruleOf(deal, "paymentWindowMinutes"), serviceFee: fmtMoney(deal.serviceFee) },
        url: `/tasks/${dealId}`,
        tag: `task-${dealId}`,
      });
    } else if (intent === "withdraw") {
      await afterBackOut(deal, before, viewer.profile.id, viewer.profile.name || "—");
    } else if (intent === "decline_invite") {
      await db.from("dispatch_offers").update({ status: "declined" }).eq("deal_id", dealId).eq("helper_id", viewer.profile.id);
      const opened = deal.status === "open";
      await notify([deal.customerId], {
        title: "push.inviteDeclinedTitle",
        body: opened ? "push.inviteDeclinedOpenBody" : "push.inviteDeclinedEndBody",
        params: { name: viewer.profile.name || "—", title: deal.title },
        url: `/tasks/${dealId}`,
        tag: `task-${dealId}`,
      });
      if (opened) await runDispatch(dealId); // the first wave goes out now
    } else if (intent === "finish") {
      await notify([deal.customerId], {
        title: "push.doneTitle",
        body: deal.payMode === "direct" ? "push.doneDirectBody" : "push.doneBody",
        params: { title: deal.title, hours: deal.checkHours },
        url: `/tasks/${dealId}`,
        tag: `task-${dealId}`,
      });
    }
  } catch (e) {
    if (e instanceof EngineError) {
      refresh();
      if (e.code === "FORBIDDEN") return { error: t("error.forbidden") };
      const floor = /Minimum fee is ₮(\d+)/.exec(e.message);
      if (floor) return { error: t("job.quoteInvalid", { amount: fmtMoney(Number(floor[1])) }) };
      const over = /Job total is over ₮(\d+)/.exec(e.message);
      if (over) return { error: t("post.reason.overMax", { amount: fmtMoney(Number(over[1])) }) };
      if (e.code === "PROOF_MISSING") return { error: t("proof.missing") };
      if (/approve the extra/.test(e.message)) return { error: t("proof.waitTopUp") };
      if (/applicants/.test(e.message)) return { error: t("job.full") };
      return { error: intent === "apply" || intent === "quote" || intent === "add_kind_apply" ? t("job.taken") : t("error.changed") };
    }
    if (e instanceof DbError && e.message.includes("this kind of task is not available")) return { error: t("care.launchScope") };
    if (isPausedError(e)) return { error: t("safety.moneyFrozen") };
    if (e instanceof DbError) return { error: t("error.changed") };
    throw e;
  }
  refresh();
  return { done: true };
}

/**
 * The chosen helper backed out (docs/decisions.md 2026-11-17 "Backing out"): the engine already
 * refunded everything and reopened the task. Tell the customer, start the search over (helpers are
 * notified again), and alert Ops when someone keeps backing out. Each step is best-effort: the
 * money and the reopening are already saved.
 */
async function afterBackOut(deal: ErrandDeal, before: Deal | null, helperId: string, helperName: string): Promise<void> {
  if (deal.status !== "open") return;
  const paid = before?.type === "errand" && before.heldAmount > 0;
  await notify([deal.customerId], {
    title: "push.backedOutTitle",
    body: paid ? "push.backedOutPaidBody" : "push.backedOutBody",
    params: { name: helperName, title: deal.title },
    url: `/tasks/${deal.id}`,
    tag: `task-${deal.id}`,
  }).catch((e) => console.error("back-out notice failed", e));
  await restartDispatch(deal.id, helperId).catch((e) => console.error("restart dispatch failed", e));
  // our fee was refunded in the ledger: send the real refund now (the background job retries)
  await runRefunds(deal.id).catch((e) => console.error("refund after back-out failed", e));
  const n = await recentBackOuts(helperId).catch(() => 0);
  if (n >= OPS_ALERT_AT) {
    await notify(await adminIds(), {
      title: "push.repeatBackOutTitle",
      body: "push.repeatBackOutBody",
      params: { n, name: helperName, days: pauseDaysFor(n, categoryTrust(deal.category) === "care", await getRules()) },
      url: `/ops/helpers/${helperId}`,
      tag: `backout-${helperId}`,
    }).catch((e) => console.error("ops back-out alert failed", e));
  }
}

/**
 * Care work finishes with a check-out instead of a handover photo (docs/decisions.md 2026-11-17
 * "Care pilot"): the time and, if the phone gives it, the position — never a picture of the person.
 */
export async function careCheckOut(dealId: string, lat: number | null, lng: number | null): Promise<{ error?: string }> {
  const viewer = await helperViewer();
  const t = await getT();
  const deal = await assignedFor(dealId, viewer.profile.id, "handover");
  if (!deal || categoryTrust(deal.category) !== "care") return { error: t("error.changed") };
  const ok = (v: unknown, lim: number) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim;
  try {
    await createAdminClient()
      .from("proofs")
      .insert({
        deal_id: dealId,
        kind: "handover",
        note: "check-out",
        lat: ok(lat, 90) ? lat : null,
        lng: ok(lng, 180) ? lng : null,
        taken_at: new Date().toISOString(),
        uploaded_by: viewer.profile.id,
      })
      .throwOnError();
    await runCommand(createAdminClient(), dealId, { type: "record_handover" }, viewer.actor);
    refresh();
    return {};
  } catch (e) {
    if (e instanceof EngineError) return { error: t("error.changed") };
    console.error("care check-out failed", e);
    return { error: t("proof.failed") };
  }
}

/** The task's own lowest price (saved at posting; older tasks: today's general minimum). */
async function taskFloor(dealId: string): Promise<number> {
  const d = await loadDeal(createAdminClient(), dealId).catch(() => null);
  if (d?.type === "errand" && d.details.minFee) return d.details.minFee;
  return minFeeAt(Date.now(), await pricingConfig());
}

/** The helper takes back one of their own progress / handover photos while the job runs (kept for Ops). */
export async function removeMyProof(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await helperViewer();
  const t = await getT();
  const dealId = String(form.get("dealId") ?? "");
  const proofId = String(form.get("proofId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(dealId) || !/^[0-9a-f-]{36}$/i.test(proofId)) return { error: t("error.generic") };
  const deal = await assignedFor(dealId, viewer.profile.id, "progress"); // in progress, and theirs
  if (!deal || !(await removeProof(proofId, dealId, viewer.profile.id))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}
