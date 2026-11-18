"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { requestBadge, setLanguages, type BadgeKind } from "@/lib/badges";

const PLATE = /^[0-9]{4}\s?[А-ЯӨҮA-Z]{2,3}$/iu;

/** A driver's licence or car registration for Ops to check (docs/decisions.md 2026-11-18 "Task conditions"). */
export async function requestBadgeAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (!viewer.actor.helperApproved) return { error: t("error.forbidden") };
  const kind = String(form.get("kind")) as BadgeKind;
  if (kind !== "driver" && kind !== "car") return { error: t("error.generic") };
  const doc = String(form.get("docPath") ?? "");
  const expires = String(form.get("expiresOn") ?? "");
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return { error: t("badges.invalid") };
  let info: Record<string, string>;
  if (kind === "driver") {
    const number = String(form.get("number") ?? "").trim().slice(0, 30);
    const classes = String(form.get("classes") ?? "").trim().toUpperCase().slice(0, 20);
    if (number.length < 4 || !/^[A-E][A-E1,\s]*$/.test(classes)) return { error: t("badges.invalid") };
    info = { number, classes };
  } else {
    const plate = String(form.get("plate") ?? "").trim().toUpperCase();
    const model = String(form.get("model") ?? "").trim().slice(0, 60);
    const type = String(form.get("type") ?? "");
    if (!PLATE.test(plate) || model.length < 2 || !["sedan", "suv", "van", "truck", "other"].includes(type)) return { error: t("badges.invalid") };
    info = { plate, model, type };
  }
  const r = await requestBadge(viewer.profile.id, kind, info, expires || null, doc);
  if (r === "file") return { error: t("badges.needDoc") };
  if (r === "duplicate") return { error: t("badges.duplicate") };
  refresh();
  return { done: true };
}

export async function saveLanguagesAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (viewer.profile.role !== "helper") return { error: t("error.forbidden") };
  await setLanguages(viewer.profile.id, form.getAll("languages").map(String));
  refresh();
  return { done: true };
}
