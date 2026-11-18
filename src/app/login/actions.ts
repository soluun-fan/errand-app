"use server";

import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { loginRules } from "@/lib/dev";
import { safeNext } from "@/lib/next-path";
import { onboardingMissing, type OnboardingState } from "@/lib/legal-rules";
import { normalizeMnPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { step: "phone"; error?: string; phoneInput?: string }
  | { step: "code"; phone: string; error?: string; devCode?: string };

async function devCodeFor(phone: string): Promise<string | undefined> {
  if (!loginRules(phone).showCode) return undefined;
  const { data, error } = await createAdminClient().rpc("dev_latest_sms_code", { p_phone: phone });
  return error || typeof data !== "string" ? undefined : data;
}

/**
 * Two-step phone sign-in. Step 1 sends an SMS code; step 2 verifies it.
 * SMS goes through the Send SMS hook (supabase/migrations/*_send_sms_hook.sql), which
 * for now records the code instead of sending it.
 */
export async function login(prev: LoginState, formData: FormData): Promise<LoginState> {
  const supabase = await createClient();
  const t = await getT();

  if (formData.get("intent") === "change-number") return { step: "phone" };

  if (prev.step === "phone") {
    const raw = String(formData.get("phone") ?? "");
    const phone = normalizeMnPhone(raw);
    if (!phone) return { step: "phone", phoneInput: raw, error: t("login.badPhone") };
    // Public deployment without real SMS: only the owner's test phones (docs/deploy.md).
    if (!loginRules(phone).allowed) return { step: "phone", phoneInput: raw, error: t("login.notOpen") };

    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) return { step: "phone", phoneInput: raw, error: t("login.sendFailed") };
    return { step: "code", phone, devCode: await devCodeFor(phone) };
  }

  if (!loginRules(prev.phone).allowed) return { step: "phone", error: t("login.notOpen") };
  const token = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return { ...prev, error: t("login.badCode") };

  const { data: verified, error } = await supabase.auth.verifyOtp({ phone: prev.phone, token, type: "sms" });
  if (error) return { ...prev, error: t("login.wrongCode") };
  const next = safeNext(formData.get("next"));
  // new people (or a changed document): name, date of birth, Terms + Privacy first
  const uid = verified.user?.id;
  if (uid) {
    const { data: p } = await createAdminClient().from("profiles").select("name, birth_date, terms_version, privacy_version").eq("id", uid).maybeSingle<OnboardingState>();
    if (p && onboardingMissing(p).length) redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  }
  // back to what they were starting (e.g. a task from the landing page); our own paths only
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
