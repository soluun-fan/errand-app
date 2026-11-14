"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { CATEGORIES, type CategoryId } from "@/lib/engine";
import { applicationForOps, decide, type Decision } from "@/lib/kyc";
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
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  if (decision !== "approve" && !note) return { error: t("ops.noteNeeded") };
  const ids = CATEGORIES.map((c) => c.id) as string[];
  const categories = form.getAll("categories").map(String).filter((c) => ids.includes(c)) as CategoryId[];
  const app = await applicationForOps(appId);
  if (!app || app.status !== "submitted") return { error: t("error.changed") };
  if (!(await decide(appId, viewer.profile.id, decision, note, categories))) return { error: t("error.changed") };
  await notify([app.userId], {
    title: decision === "approve" ? "push.kycApprovedTitle" : decision === "reject" ? "push.kycRejectedTitle" : "push.kycChangesTitle",
    body: decision === "approve" ? "push.kycApprovedBody" : "push.kycDecisionBody",
    url: decision === "approve" ? "/jobs" : "/helper/apply",
    tag: "kyc",
  });
  redirect("/ops/helpers");
}
