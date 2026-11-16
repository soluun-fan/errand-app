"use server";

import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { ADDRESS_KINDS, saveAddress, type AddressKind } from "@/lib/addresses";
import { getViewer } from "@/lib/auth";
import { runDispatch } from "@/lib/dispatch/run";
import { insertDeal } from "@/lib/db/deals";
import { CATEGORIES, EngineError, amountDue, createErrand, type CategoryId, type ErrandDetails } from "@/lib/engine";
import { fmtMoney, parseUbLocal } from "@/lib/format";
import { invitableHelper } from "@/lib/helper-profile";
import { liveCategories } from "@/lib/orgs";
import { pricingConfig } from "@/lib/pricing";
import { DetailsJson, PinJson, Uuid, parseOr } from "@/lib/input";
import { getControls, isPausedError, openTaskCount } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PostState {
  error?: string;
  /** Step to jump back to: 0 type, 1 what, 2 where & details, 3 review (post-flow STEPS). */
  step?: number;
}

/** Indexes of the post flow's steps (post-flow.tsx STEPS). */
const STEP = { type: 0, what: 1, where: 2, review: 3 } as const;

const int = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[\s,₮]/g, "");
  return s === "" ? 0 : Number(s);
};

/**
 * Last step of the post flow. Re-checks everything — the client only guides. The engine
 * computes the system price from the details and rejects a fee below it.
 */
export async function postTask(_prev: PostState, form: FormData): Promise<PostState> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  const cfg = await pricingConfig(); // today's prices (live Ops settings)

  // Safety controls (docs/decisions.md "Safety pack"); the database enforces the pause too.
  const controls = await getControls();
  if (controls.postingPaused) return { error: t("safety.postingPaused"), step: STEP.review };
  if ((await openTaskCount(viewer.profile.id)) >= controls.maxOpenTasks) {
    return { error: t("safety.tooManyOpen", { n: controls.maxOpenTasks }), step: STEP.review };
  }

  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  const pickupAddress = String(form.get("pickup") ?? "").trim();
  const category = String(form.get("category")) as CategoryId;

  if (!CATEGORIES.some((c) => c.id === category)) return { error: t("error.generic"), step: STEP.type };
  if (!(await liveCategories()).includes(category)) return { error: t("specialized.unavailable"), step: STEP.type };
  if (!title || !description || title.length > cfg.titleMax || description.length > cfg.descriptionMax) {
    return { error: t("task.reasonWhat"), step: STEP.what };
  }
  if (!address) return { error: t("task.reasonWhere"), step: STEP.where };

  const rawWhen = String(form.get("scheduledAt") ?? "");
  const scheduledAt = rawWhen ? parseUbLocal(rawWhen) : null;
  if (rawWhen && (scheduledAt === null || scheduledAt <= Date.now())) return { error: t("task.reasonTime"), step: STEP.where };

  // shape only (docs/rules.md "Input validation"); the engine checks ranges and the price
  const parsedDetails = parseOr(DetailsJson, String(form.get("details") ?? ""));
  if (!parsedDetails) return { error: t("error.generic"), step: STEP.where };
  let details: Partial<ErrandDetails> = parsedDetails;

  // a broken pin is ignored — the address text still works
  const location = parseOr(PinJson, String(form.get("location") ?? ""));
  // two-point tasks only (the engine ignores it otherwise); with both pins it measures the distance
  const pickupLocation = parseOr(PinJson, String(form.get("pickupLocation") ?? ""));

  const fee = int(form.get("fee"));
  const itemBudget = form.get("buyForMe") === "on" ? int(form.get("itemBudget")) : 0;
  if (form.get("buyForMe") === "on" && !(itemBudget > 0)) return { error: t("task.reasonBudget"), step: STEP.where };
  if (!Number.isInteger(fee) || !Number.isInteger(itemBudget)) return { error: t("error.generic"), step: STEP.review };

  // Sent to one helper first (from their profile): they must be approved, not suspended, and do this kind of task.
  let invite: { helperId: string; openAfter: boolean } | null = null;
  const invited = String(form.get("invite") ?? "");
  if (invited) {
    const helperId = parseOr(Uuid, invited);
    const h = helperId ? await invitableHelper(helperId) : null;
    if (!h || h.id === viewer.profile.id) return { error: t("invite.unavailable"), step: STEP.review };
    if (!h.categories.includes(category)) return { error: t("invite.notThisKind", { name: h.name }), step: STEP.type };
    invite = { helperId: h.id, openAfter: form.get("inviteOpenAfter") === "on" };
  }

  const id = crypto.randomUUID();
  try {
    const created = createErrand(
      {
        id,
        title,
        description,
        category,
        mode: "now", // helpers accept the price or counter once (docs/decisions.md 2026-11-15 "Pricing")
        scheduledAt,
        pickupAddress,
        pickupLocation,
        address,
        location,
        itemBudget,
        fee,
        customerId: viewer.profile.id,
        details,
        invite,
      },
      { now: Date.now(), actor: viewer.actor },
      cfg,
    );
    // what will be held when a helper is chosen — over the per-task cap it could never be paid
    if (amountDue(created.deal) > controls.maxDealAmount) {
      return { error: t("safety.capDeal", { amount: fmtMoney(controls.maxDealAmount) }), step: STEP.where };
    }
    await insertDeal(createAdminClient(), created);
    details = created.deal.details;
  } catch (e) {
    if (e instanceof Error && /this kind of task is not available/.test(e.message)) return { error: t("specialized.unavailable"), step: STEP.type };
    if (isPausedError(e)) return { error: t("safety.postingPaused"), step: STEP.review };
    if (e instanceof EngineError) {
      const min = /Minimum fee is ₮(\d+)/.exec(e.message);
      if (min) return { error: t("post.reason.fee", { amount: fmtMoney(Number(min[1])) }), step: STEP.review };
      const max = /Maximum fee is ₮(\d+)/.exec(e.message);
      if (max) return { error: t("price.tooHigh", { amount: fmtMoney(Number(max[1])) }), step: STEP.review };
      if (/Pin must be inside Mongolia/.test(e.message)) return { error: t("post.reason.pin"), step: STEP.where };
      if (/Distance must be between/.test(e.message)) return { error: t("post.reason.far"), step: STEP.where };
      return { error: e.message, step: STEP.where };
    }
    throw e;
  }

  // "Энэ хаягийг хадгалах" — after the task exists; a failed save never blocks posting.
  const saveAs = String(form.get("saveAs") ?? "") as AddressKind;
  if (ADDRESS_KINDS.includes(saveAs)) {
    const x = details as ErrandDetails;
    try {
      await saveAddress(
        { kind: saveAs, label: null, address, entrance: x.entrance, floor: x.floor, unit: x.unit, lift: x.lift, note: x.note, lat: location?.lat ?? null, lng: location?.lng ?? null },
        viewer.profile.id,
      );
    } catch (e) {
      console.error("saving address failed", e);
    }
  }
  // First wave goes out right away (nearest, best helpers); the task screen keeps it moving.
  try {
    await runDispatch(id);
  } catch (e) {
    console.error("dispatch failed", e);
  }
  redirect(`/tasks/${id}`);
}
