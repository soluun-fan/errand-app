"use server";

import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { LEGAL_VERSIONS, cleanDisplayName, isAdultOn, onboardingMissing, ubToday } from "@/lib/legal-rules";
import { safeNext } from "@/lib/next-path";
import { createAdminClient } from "@/lib/supabase/admin";

export type OnboardingResult = { error?: string };

/**
 * Registration (docs/decisions.md 2026-11-18 "Registration and terms"): a display name, date of
 * birth (18+, also checked by the database), and accepting the current Terms and Privacy policy.
 * Each acceptance is recorded with its version. The date of birth is set once.
 */
export async function completeOnboarding(_prev: OnboardingResult, form: FormData): Promise<OnboardingResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  const p = viewer.profile;
  const missing = onboardingMissing({ name: p.name, birth_date: p.birth_date ?? null, terms_version: p.terms_version ?? null, privacy_version: p.privacy_version ?? null });
  const patch: Record<string, unknown> = {};

  if (missing.includes("name")) {
    const name = cleanDisplayName(String(form.get("name") ?? ""));
    if (!name) return { error: t("onboarding.err.name") };
    patch.name = name;
  }
  if (missing.includes("birth")) {
    const birth = String(form.get("birthDate") ?? "");
    if (!isAdultOn(birth, ubToday())) return { error: t("onboarding.err.age") };
    patch.birth_date = birth;
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
    if (error) return { error: /18 or older/.test(error.message) ? t("onboarding.err.age") : t("error.generic") };
  }
  if (accepted.length) {
    await db
      .from("legal_acceptances")
      .upsert(accepted.map((d) => ({ user_id: p.id, document: d, version: LEGAL_VERSIONS[d] })), { onConflict: "user_id,document,version", ignoreDuplicates: true })
      .throwOnError();
  }
  redirect(safeNext(form.get("next")));
}
