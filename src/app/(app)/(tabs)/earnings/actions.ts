"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtMoney } from "@/lib/format";
import { getRules } from "@/lib/rules";
import { requestWithdrawal } from "@/lib/withdrawals";
import { unverifiedHelpersTestMode } from "@/lib/helper-test-mode";

/** The helper withdraws everything available to their own checked bank account. */
export async function withdrawAction(_prev: ActionResult, _form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (!viewer.actor.helperApproved) return { error: t("error.forbidden") };
  if (unverifiedHelpersTestMode && viewer.profile.test_helper) return { error: t("error.forbidden") };
  const r = await requestWithdrawal(viewer.profile.id);
  if (!r.ok) {
    const rules = await getRules();
    if (r.reason === "unchecked") return { error: t("earnings.err.unchecked") };
    if (r.reason === "minimum") return { error: t("earnings.err.minimum", { amount: fmtMoney(rules.withdrawMin) }) };
    if (r.reason === "tooMany") return { error: t("earnings.err.tooMany", { n: rules.withdrawalsPerDay }) };
    return { error: t("error.generic") };
  }
  refresh();
  return { done: true };
}
