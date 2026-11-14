"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { acknowledgeIncident, resolveIncident } from "@/lib/incidents";
import { updateControls } from "@/lib/safety";

async function requireAdmin() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer.profile.role === "admin" ? viewer : null;
}

const money = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[\s,₮]/g, ""));
  return Number.isInteger(n) && n > 0 && n <= 1_000_000_000 ? n : null;
};

/** /ops/safety: pause switches and caps. Every save is in the Ops audit log. */
export async function saveControls(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const maxDealAmount = money(form.get("maxDealAmount"));
  const maxCustomerDaily = money(form.get("maxCustomerDaily"));
  const maxTotalHeld = money(form.get("maxTotalHeld"));
  const maxOpenTasks = Number(form.get("maxOpenTasks"));
  if (!maxDealAmount || !maxCustomerDaily || !maxTotalHeld || !Number.isInteger(maxOpenTasks) || maxOpenTasks < 1 || maxOpenTasks > 50) {
    return { error: t("opsSafety.invalid") };
  }
  const postingPaused = form.get("postingPaused") === "on";
  const paymentsPaused = form.get("paymentsPaused") === "on";
  const pauseNote = String(form.get("pauseNote") ?? "").trim().slice(0, 300) || null;
  if ((postingPaused || paymentsPaused) && !pauseNote) return { error: t("opsSafety.noteNeeded") };
  await updateControls(viewer.profile.id, { postingPaused, paymentsPaused, pauseNote, maxDealAmount, maxCustomerDaily, maxTotalHeld, maxOpenTasks });
  refresh();
  return { done: true };
}

export async function acknowledge(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  if (!(await acknowledgeIncident(String(form.get("id") ?? ""), viewer.profile.id))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}

export async function resolve(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);
  if (note.length < 5) return { error: t("opsIncidents.noteNeeded") };
  if (!(await resolveIncident(String(form.get("id") ?? ""), viewer.profile.id, note))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}
