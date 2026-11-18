"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { setPayout } from "@/lib/payout";

/** The helper adds or changes their bank account; then back to work (or the profile). */
export async function savePayout(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  const r = await setPayout(viewer.profile.id, {
    bank: String(form.get("bank") ?? ""),
    accountNumber: String(form.get("accountNumber") ?? ""),
    holderName: String(form.get("holderName") ?? ""),
  });
  if (r === "notHelper") return { error: t("error.forbidden") };
  if (r === "bank") return { error: t("kyc.errors.bank") };
  if (r === "account") return { error: t("kyc.errors.account") };
  if (r === "holder") return { error: t("payout.holderMismatch") };
  redirect(form.get("next") === "profile" ? "/profile" : "/jobs");
}
