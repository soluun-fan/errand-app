"use server";

import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { unverifiedHelpersTestMode } from "@/lib/helper-test-mode";
import { KycFormInput, parseOr } from "@/lib/input";
import { submitIdentity } from "@/lib/kyc";
import { KYC_DOCS, cleanLegalName, isAdult, type KycDoc } from "@/lib/kyc-rules";
import { isOnboarded } from "@/lib/legal-rules";
import { notify } from "@/lib/push";
import { adminIds } from "@/lib/safety";

/** A customer's ID check (2026-11-26): the same documents and Ops review as helpers, nothing else. */
export async function submitIdentityCheck(raw: { legalName: string; birthDate: string; idLast4: string; files: Partial<Record<KycDoc, string>>; consent: boolean }): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!isOnboarded(viewer.profile)) redirect("/onboarding");
  const t = await getT();
  if (unverifiedHelpersTestMode) return { error: t("verify.unavailable") };
  // the helper form's schema already describes these fields; kinds and bank are simply absent here
  const f = parseOr(KycFormInput.partial(), raw);
  if (!f) return { error: t("kyc.errors.files") };
  const legalName = cleanLegalName(String(f.legalName ?? ""));
  if (!legalName) return { error: t("kyc.errors.name") };
  if (!isAdult(String(f.birthDate ?? ""), new Date())) return { error: t("kyc.errors.age") };
  if (!/^\d{4}$/.test(String(f.idLast4 ?? ""))) return { error: t("kyc.errors.last4") };
  const files = {} as Record<KycDoc, string>;
  for (const d of KYC_DOCS) {
    const p = f.files?.[d];
    if (typeof p !== "string" || !p) return { error: t("kyc.errors.files") };
    files[d] = p;
  }
  if (f.consent !== true) return { error: t("kyc.errors.consent") };
  const r = await submitIdentity(viewer.profile.id, { legalName, idLast4: String(f.idLast4), birthDate: String(f.birthDate), files });
  if (!r.ok) return { error: t(r.reason === "open" ? "kyc.errors.open" : "kyc.errors.files") };
  await notify(await adminIds(), {
    title: "push.kycNewTitle",
    body: "push.kycNewBody",
    params: { name: viewer.profile.name || legalName },
    url: "/ops/helpers",
    tag: "kyc-queue",
  });
  redirect("/verify");
}
