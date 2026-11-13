"use server";

import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { devShowSmsCodes } from "@/lib/dev";
import { normalizeMnPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { step: "phone"; error?: string; phoneInput?: string }
  | { step: "code"; phone: string; error?: string; devCode?: string };

async function devCodeFor(phone: string): Promise<string | undefined> {
  if (!devShowSmsCodes()) return undefined;
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

    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) return { step: "phone", phoneInput: raw, error: t("login.sendFailed") };
    return { step: "code", phone, devCode: await devCodeFor(phone) };
  }

  const token = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return { ...prev, error: t("login.badCode") };

  const { error } = await supabase.auth.verifyOtp({ phone: prev.phone, token, type: "sms" });
  if (error) return { ...prev, error: t("login.wrongCode") };
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
