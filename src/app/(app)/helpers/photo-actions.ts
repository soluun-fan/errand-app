"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { Uuid, parseOr } from "@/lib/input";
import {
  REPORT_REASONS,
  answerAsks,
  askToShow,
  createReviewPhotoSlot,
  hideWorkPhoto,
  removeWorkPhoto,
  reportWorkPhoto,
  type ReportReason,
  type ReviewPhotoSlot,
} from "@/lib/work-photos";

/**
 * Work photos (docs/decisions.md 2026-11-18 "Work photos"): every action re-checks who is asking;
 * src/lib/work-photos.ts and the database (work_photos_check) check what they may do.
 */
async function viewerOrLogin() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

/** The customer, while rating: a signed upload slot for one review photo. */
export async function prepareReviewPhoto(rawDealId: string): Promise<ReviewPhotoSlot | { error: string }> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  const dealId = parseOr(Uuid, rawDealId);
  if (!dealId) return { error: t("error.generic") };
  const slot = await createReviewPhotoSlot(dealId, viewer.profile.id);
  if (slot === "tooMany") return { error: t("workPhotos.tooMany", { n: 3 }) };
  if (slot === "no") return { error: t("error.changed") };
  return slot;
}

/** The helper picks some of their photos of a finished job to show; the customer is asked. */
export async function askPortfolioAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  const dealId = parseOr(Uuid, String(form.get("dealId") ?? ""));
  const ids = form.getAll("proofId").map((v) => parseOr(Uuid, String(v))).filter((x): x is string => Boolean(x));
  if (!dealId || !ids.length) return { error: t("workPhotos.pickOne") };
  const r = await askToShow(dealId, viewer.profile.id, ids);
  if (r === "no") return { error: t("error.changed") };
  if (r === "tooMany") return { error: t("workPhotos.tooManyAsk", { n: 4 }) };
  refresh();
  return { done: true };
}

/** The customer answers the helper's request: show them, or not. */
export async function answerPortfolioAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  const dealId = parseOr(Uuid, String(form.get("dealId") ?? ""));
  if (!dealId) return { error: t("error.generic") };
  const r = await answerAsks(dealId, viewer.profile.id, form.get("allow") === "1");
  if (r === "no") return { error: t("error.changed") };
  refresh();
  return { done: true };
}

/** The helper, the task's customer or the uploader takes a photo down. */
export async function removeWorkPhotoAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  const photoId = parseOr(Uuid, String(form.get("photoId") ?? ""));
  if (!photoId || !(await removeWorkPhoto(photoId, viewer.profile.id))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}

/** Anyone signed in reports a public photo. */
export async function reportWorkPhotoAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  const photoId = parseOr(Uuid, String(form.get("photoId") ?? ""));
  const reason = String(form.get("reason") ?? "");
  if (!photoId || !(REPORT_REASONS as readonly string[]).includes(reason)) return { error: t("workPhotos.pickReason") };
  const r = await reportWorkPhoto(photoId, viewer.profile.id, reason as ReportReason);
  if (r === "no") return { error: t("error.changed") };
  refresh();
  return { done: true };
}

/** Ops takes a public photo down (logged). */
export async function hideWorkPhotoAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  if (viewer.profile.role !== "admin") return { error: t("ops.notAdmin") };
  const photoId = parseOr(Uuid, String(form.get("photoId") ?? ""));
  const reason = String(form.get("reason") ?? "").trim();
  if (!photoId) return { error: t("error.generic") };
  if (!(await hideWorkPhoto(photoId, viewer.profile.id, reason))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}
