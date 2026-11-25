"use server";
import type { Database } from "@/lib/db/database.types";

import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { LEGAL_VERSIONS, cleanDisplayName, onboardingMissing } from "@/lib/legal-rules";
import { safeNext } from "@/lib/next-path";
import { createAdminClient } from "@/lib/supabase/admin";

export type OnboardingResult = { error?: string };

/**
 * Registration: a display name, self-confirmed 18+ age (no birth date stored), and acceptance of
 * the current Terms and Privacy policy.
 * Each acceptance is recorded with its version. The date of birth is set once.
 */
export async function completeOnboarding(_prev: OnboardingResult, form: FormData): Promise<OnboardingResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  const p = viewer.profile;
  const missing = onboardingMissing({
    name: p.name,
    age_confirmed_at: p.age_confirmed_at ?? null,
    terms_version: p.terms_version ?? null,
    privacy_version: p.privacy_version ?? null,
  });
  const patch: Database["public"]["Tables"]["profiles"]["Update"] = {};

  if (missing.includes("name")) {
    const name = cleanDisplayName(String(form.get("name") ?? ""));
    if (!name) return { error: t("onboarding.err.name") };
    patch.name = name;
  }
  if (missing.includes("age")) {
    if (form.get("age") !== "on") return { error: t("onboarding.err.age") };
    patch.age_confirmed_at = new Date().toISOString();
  }
  const accepted: ("terms" | "privacy")[] = [];
  if (missing.includes("terms")) {
    if (form.get("terms") !== "on") return { error: t("onboarding.err.terms") };
    patch.terms_version = LEGAL_VERSIONS.terms;
    accepted.push("terms");
  }
  if (missing.includes("privacy")) {
    if (form.get("privacy") !== "on") return { error: t("onboarding.err.privacy") };
    patch.privacy_version = LEGAL_VERSIONS.privacy;
    accepted.push("privacy");
  }

  const db = createAdminClient();
  if (Object.keys(patch).length) {
    const { error } = await db.from("profiles").update(patch).eq("id", p.id);
    if (error) return { error: t("error.generic") };
  }
  if (accepted.length) {
    await db
      .from("legal_acceptances")
      .upsert(
        accepted.map((d) => ({ user_id: p.id, document: d, version: LEGAL_VERSIONS[d] })),
        { onConflict: "user_id,document,version", ignoreDuplicates: true },
      )
      .throwOnError();
  }
  redirect(safeNext(form.get("next")));
}
