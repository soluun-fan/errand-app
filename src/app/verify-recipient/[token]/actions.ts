"use server";

import {
  beginRecipientVerification as begin,
  checkRecipientVerification as check,
  type RecipientVerificationView,
  VerifyMnError,
} from "@/lib/verify-mn";

export interface RecipientVerificationActionState {
  error?: string;
  view?: RecipientVerificationView | null;
  inviteValid?: boolean;
}

export async function beginRecipientVerification(
  _previous: RecipientVerificationActionState,
  form: FormData,
): Promise<RecipientVerificationActionState> {
  const token = String(form.get("token") ?? "");
  try {
    const view = await begin(token);
    return view ? { view, inviteValid: Date.parse(view.inviteExpiresAt) > Date.now() } : { error: "invalid" };
  } catch (error) {
    if (error instanceof VerifyMnError && error.message.includes("limit")) return { error: "limit" };
    console.error("Verify.MN recipient verification start failed", {
      reason:
        error instanceof Error && error.message.startsWith("VERIFY_MN_API_KEY is not set")
          ? "missing_api_key"
          : "provider_or_storage_error",
      status: error instanceof VerifyMnError ? error.status : undefined,
    });
    return { error: "unavailable" };
  }
}

export async function checkRecipientVerification(token: string): Promise<RecipientVerificationActionState> {
  try {
    const view = await check(token);
    return view ? { view, inviteValid: Date.parse(view.inviteExpiresAt) > Date.now() } : { error: "invalid" };
  } catch {
    return { error: "unavailable" };
  }
}
