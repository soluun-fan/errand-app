"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { CATEGORIES, type CategoryId } from "@/lib/engine";
import { applicationForOps, decide, reopenVerification, revokeHelper, setComputerAllowed, type Decision } from "@/lib/kyc";
import { refresh } from "next/cache";
import { Uuid, parseOr } from "@/lib/input";
import { notify } from "@/lib/push";

/** Ops decision on one helper application. Admins only; a note is required unless approving. */
export async function decideKyc(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (viewer.profile.role !== "admin") return { error: t("ops.notAdmin") };
  const appId = String(form.get("appId") ?? "");
  const decision = String(form.get("decision") ?? "") as Decision;
  if (!["approve", "reject", "changes_requested"].includes(decision)) return { error: t("error.generic") };
  const note =
    String(form.get("note") ?? "")
      .trim()
      .slice(0, 500) || null;
  if (decision !== "approve" && !note) return { error: t("ops.noteNeeded") };
  const ids = CATEGORIES.map((c) => c.id) as string[];
  const categories = form
    .getAll("categories")
    .map(String)
    .filter((c) => ids.includes(c)) as CategoryId[];
  const app = await applicationForOps(appId);
  if (!app || app.status !== "submitted") return { error: t("error.changed") };
  if (!(await decide(appId, viewer.profile.id, decision, note, categories))) return { error: t("error.changed") };
  await notify([app.userId], {
    title: decision === "approve" ? "push.kycApprovedTitle" : decision === "reject" ? "push.kycRejectedTitle" : "push.kycChangesTitle",
    body: decision === "approve" ? "push.kycApprovedBody" : "push.kycDecisionBody",
    url: app.purpose === "identity" ? "/verify" : decision === "approve" ? "/jobs" : "/helper/apply",
    tag: "kyc",
  });
  redirect("/ops/helpers");
}

/**
 * Send an approved person back for a re-check (owner 2026-11-26): undoes the approval so they submit
 * a real ID and bank account again. Admins only; a note for the person is required.
 */
export async function reopenKyc(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (viewer.profile.role !== "admin") return { error: t("ops.notAdmin") };
  const appId = String(form.get("appId") ?? "");
  const note = String(form.get("note") ?? "")
    .trim()
    .slice(0, 500);
  if (!note) return { error: t("ops.noteNeeded") };
  const app = await applicationForOps(appId);
  if (!app) return { error: t("error.changed") };
  const r = await reopenVerification(appId, viewer.profile.id, note);
  if (r === "busy") return { error: t("ops.reopenBusy") };
  if (r === "changed") return { error: t("error.changed") };
  // a customer's ID check is redone on /verify, a helper's on the application form
  await notify([app.userId], { title: "push.kycChangesTitle", body: "push.kycDecisionBody", url: app.purpose === "identity" ? "/verify" : "/helper/apply", tag: "kyc" });
  redirect("/ops/helpers");
}

/** Switch off one person's helper access (Ops "All helpers" list). Admins only; a note is required. */
export async function revokeHelperAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (viewer.profile.role !== "admin") return { error: t("ops.notAdmin") };
  const userId = String(form.get("userId") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: t("error.generic") };
  if (!note) return { error: t("ops.noteNeeded") };
  const r = await revokeHelper(userId, viewer.profile.id, note);
  if (r === "busy") return { error: t("ops.reopenBusy") };
  if (r === "changed") return { error: t("error.changed") };
  await notify([userId], { title: "push.kycChangesTitle", body: "push.kycDecisionBody", url: "/helper/apply", tag: "kyc" });
  redirect("/ops/helpers");
}

/** Let a helper work from a computer, or not (Ops "All helpers" list, 2026-11-27). Admins only. */
export async function setComputerAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (viewer.profile.role !== "admin") return { error: t("ops.notAdmin") };
  const userId = parseOr(Uuid, form.get("userId"));
  if (!userId) return { error: t("error.generic") };
  if (!(await setComputerAllowed(userId, viewer.profile.id, form.get("allowed") === "1"))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}
