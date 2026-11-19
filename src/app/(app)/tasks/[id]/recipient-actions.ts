"use server";

import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { isOnboarded } from "@/lib/legal-rules";
import { loadDeal } from "@/lib/db/deals";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRecipientVerificationInvite } from "@/lib/verify-mn";
import { redirect } from "next/navigation";

export interface RecipientInviteActionState {
  error?: string;
  sharePath?: string;
  status?: "NOT_STARTED" | "CREATING" | "PENDING" | "VERIFIED" | "EXPIRED";
  phone?: string;
}

export async function createRecipientInvite(
  _previous: RecipientInviteActionState,
  form: FormData,
): Promise<RecipientInviteActionState> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!isOnboarded(viewer.profile)) redirect("/onboarding");
  const t = await getT();
  const dealId = String(form.get("dealId") ?? "");
  const phone = String(form.get("phone") ?? "");
  const deal = await loadDeal(createAdminClient(), dealId);
  if (!deal || deal.type !== "errand" || deal.customerId !== viewer.profile.id) return { error: t("common.notFound") };
  if (!["open", "awaiting_payment", "matched", "in_progress"].includes(deal.status)) {
    return { error: t("verifyRecipient.taskClosed") };
  }

  try {
    const invite = await createRecipientVerificationInvite(deal.id, viewer.profile.id, phone);
    if (!invite.token) return { status: "VERIFIED", phone: invite.view.phone };
    return {
      status: invite.view.status,
      phone: invite.view.phone,
      sharePath: `/verify-recipient/${invite.token}`,
    };
  } catch (error) {
    if (error instanceof TypeError) return { error: t("verifyRecipient.invalidPhone") };
    if (error instanceof Error && error.message.includes("different phone number")) {
      return { error: t("verifyRecipient.activeDifferentPhone") };
    }
    console.error("recipient verification invite failed", {
      reason:
        error instanceof Error && error.message.startsWith("VERIFY_MN_API_KEY is not set")
          ? "missing_api_key"
          : "provider_or_storage_error",
      status: typeof error === "object" && error !== null && "status" in error ? error.status : undefined,
    });
    return { error: t("verifyRecipient.unavailable") };
  }
}
