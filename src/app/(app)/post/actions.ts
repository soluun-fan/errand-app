"use server";

import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { insertDeal } from "@/lib/db/deals";
import { CATEGORIES, DEFAULT_CONFIG, EngineError, createErrand, type CategoryId, type ErrandDetails } from "@/lib/engine";
import { fmtMoney, parseUbLocal } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PostState {
  error?: string;
  /** Step to jump back to: 0 what, 1 where & details, 2 review. */
  step?: number;
}

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
  const cfg = DEFAULT_CONFIG;

  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  const pickupAddress = String(form.get("pickup") ?? "").trim();
  const category = String(form.get("category")) as CategoryId;

  if (!CATEGORIES.some((c) => c.id === category)) return { error: t("error.generic"), step: 0 };
  if (!title || !description || title.length > cfg.titleMax || description.length > cfg.descriptionMax) {
    return { error: t("task.reasonWhat"), step: 0 };
  }
  if (!address) return { error: t("task.reasonWhere"), step: 1 };

  const rawWhen = String(form.get("scheduledAt") ?? "");
  const scheduledAt = rawWhen ? parseUbLocal(rawWhen) : null;
  if (rawWhen && (scheduledAt === null || scheduledAt <= Date.now())) return { error: t("task.reasonTime"), step: 1 };

  let details: Partial<ErrandDetails>;
  try {
    details = JSON.parse(String(form.get("details") ?? "{}")) as Partial<ErrandDetails>;
  } catch {
    return { error: t("error.generic"), step: 1 };
  }

  const fee = int(form.get("fee"));
  const itemBudget = form.get("buyForMe") === "on" ? int(form.get("itemBudget")) : 0;
  if (form.get("buyForMe") === "on" && !(itemBudget > 0)) return { error: t("task.reasonBudget"), step: 1 };
  if (!Number.isInteger(fee) || !Number.isInteger(itemBudget)) return { error: t("error.generic"), step: 2 };

  const id = crypto.randomUUID();
  try {
    const created = createErrand(
      {
        id,
        title,
        description,
        category,
        mode: "now", // Instant: system price, first to accept (Custom quotes come later — docs/decisions.md)
        scheduledAt,
        pickupAddress,
        address,
        itemBudget,
        fee,
        customerId: viewer.profile.id,
        details,
      },
      { now: Date.now(), actor: viewer.actor },
      cfg,
    );
    await insertDeal(createAdminClient(), created);
  } catch (e) {
    if (e instanceof EngineError) {
      const min = /Minimum fee is ₮(\d+)/.exec(e.message);
      if (min) return { error: t("post.reason.fee", { amount: fmtMoney(Number(min[1])) }), step: 2 };
      return { error: e.message, step: 1 };
    }
    throw e;
  }
  redirect(`/tasks/${id}?pay=1`);
}
