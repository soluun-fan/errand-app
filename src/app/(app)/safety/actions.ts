"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { loadDeal } from "@/lib/db/deals";
import { checkReport, cleanPosition } from "@/lib/incident-rules";
import { isParty, raiseSos, reportIncident } from "@/lib/incidents";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * SOS: alerts the operations team with the sender's position (if the phone gave one). Allowed for
 * either person on the task in ANY status — an SOS is never refused on a technicality.
 * The other person is not told.
 */
export async function sendSos(dealId: string, rawPos: unknown): Promise<{ ok: true } | { error: string }> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  const deal = /^[0-9a-f-]{36}$/i.test(dealId) ? await loadDeal(createAdminClient(), dealId) : null;
  if (!deal || !isParty(deal, viewer.profile.id)) return { error: t("common.notFound") };
  try {
    await raiseSos(deal, viewer.profile.id, cleanPosition(rawPos));
  } catch (e) {
    console.error("SOS failed", e);
    return { error: t("safety.sosFailed") };
  }
  refresh();
  return { ok: true };
}

/** "Report a problem" on a task: kind + description → Ops queue. Max 5 an hour per person. */
export async function reportProblem(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  const dealId = String(form.get("dealId") ?? "");
  const deal = /^[0-9a-f-]{36}$/i.test(dealId) ? await loadDeal(createAdminClient(), dealId) : null;
  if (!deal || !isParty(deal, viewer.profile.id)) return { error: t("common.notFound") };
  const r = checkReport(String(form.get("kind") ?? ""), String(form.get("note") ?? ""));
  if (!r.ok) return { error: r.reason === "kind" ? t("safety.pickKind") : t("safety.noteShort") };
  const saved = await reportIncident(deal, viewer.profile.id, r.kind, r.note);
  if (!saved.ok) return { error: t("safety.tooManyReports") };
  return { done: true };
}
