"use server";

import { cookies } from "next/headers";
import { MODE_COOKIE } from "@/lib/mode-cookie";

import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { loginRules } from "@/lib/dev";
import { safeNext } from "@/lib/next-path";
import { onboardingMissing, type OnboardingState } from "@/lib/legal-rules";
import { normalizeMnPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { checkVerifyMnLogin, clearPendingLogin, pendingLogin, startVerifyMnLogin, verifyMnLoginEnabled, type LoginChallengeView } from "@/lib/verify-mn-login";

export type LoginState =
  | { step: "verify-mn"; view: LoginChallengeView; error?: string }
  | { step: "phone"; error?: string; phoneInput?: string }
  | { step: "code"; phone: string; error?: string; devCode?: string };

async function devCodeFor(phone: string): Promise<string | undefined> {
  if (!loginRules(phone).showCode) return undefined;
  const { data, error } = await createAdminClient().rpc("dev_latest_sms_code", { p_phone: phone });
  return error || typeof data !== "string" ? undefined : data;
}

export async function login(prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getT();
  if (formData.get("intent") === "change-number") {
    if (verifyMnLoginEnabled()) await clearPendingLogin();
    return { step: "phone" };
  }

  if (verifyMnLoginEnabled()) {
    if (!process.env.VERIFY_MN_API_KEY) return { step: "phone", error: t("login.verifySetup") };
    if (prev.step === "verify-mn") {
      let result: Awaited<ReturnType<typeof checkVerifyMnLogin>>;
      try {
        result = await checkVerifyMnLogin(prev.view.sessionId);
      } catch {
        const view = await pendingLogin();
        return view ? { step: "verify-mn", view, error: t("verifyRecipient.statusFailed") } : { step: "phone", error: t("verifyRecipient.expired") };
      }
      if (result.status === "pending") return { step: "verify-mn", view: result.view };
      if (result.status === "expired") return { step: "phone", error: t("verifyRecipient.expired") };
      if (result.status === "auth-failed") return { step: "verify-mn", view: prev.view, error: t("login.verifyLoginFailed") };
      return finishLogin(result.userId, formData);
    }
    const raw = String(formData.get("phone") ?? "");
    const phone = normalizeMnPhone(raw);
    if (!phone) return { step: "phone", phoneInput: raw, error: t("login.badPhone") };
    try {
      const view = await startVerifyMnLogin(phone);
      if (view) return { step: "verify-mn", view };
    } catch {
      // Only display the retry message. Provider errors can contain private data.
    }
    return { step: "phone", phoneInput: raw, error: t("login.verifyStartFailed") };
  }
  if (prev.step === "verify-mn") return { step: "phone" };
  const supabase = await createClient();
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
  return finishLogin(verified.user?.id, formData);
}

async function finishLogin(uid: string | undefined, formData: FormData): Promise<never> {
  const next = safeNext(formData.get("next"));
  // new people (or a changed document): name, date of birth, Terms + Privacy first
  if (uid) {
    const { data: p } = await createAdminClient().from("profiles").select("name, age_confirmed_at, terms_version, privacy_version").eq("id", uid).maybeSingle<OnboardingState>();
    if (p && onboardingMissing(p).length) redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  }
  // back to what they were starting (e.g. a task from the landing page); our own paths only
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(MODE_COOKIE);
  await clearPendingLogin();
  redirect("/login");
}
