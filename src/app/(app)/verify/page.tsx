import { redirect } from "next/navigation";
import { FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { unverifiedHelpersTestMode } from "@/lib/helper-test-mode";
import { latestApplication } from "@/lib/kyc";
import { KYC_LEVEL_VERIFIED } from "@/lib/kyc-rules";
import { titled } from "@/lib/page-title";
import { IdentityForm } from "./identity-form";

export const generateMetadata = titled("verify.title");

/** /verify — a customer's ID check, needed before jobs in their home or with a person (2026-11-26). */
export default async function VerifyPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [t, app] = await Promise.all([getT(), latestApplication(viewer.profile.id, "identity")]);
  const verified = viewer.profile.kyc_level >= KYC_LEVEL_VERIFIED;
  const canApply = !verified && !unverifiedHelpersTestMode && (!app || app.status === "changes_requested" || app.status === "rejected");
  return (
    <>
      <FlowHeader href="/profile" label={t("common.back")} title={t("verify.title")} />
      {verified ? (
        <Note tone="held">{t("verify.verified")}</Note>
      ) : unverifiedHelpersTestMode ? (
        <Note tone="info">{t("verify.unavailable")}</Note>
      ) : (
        app && (
          <Note tone={app.status === "submitted" ? "info" : "warn"}>
            <span className="block font-semibold">{t(`kyc.status.${app.status}`)}</span>
            {app.decisionNote && <span className="mt-1 block">{t("kyc.note", { note: app.decisionNote })}</span>}
          </Note>
        )
      )}
      {canApply && (
        <>
          <p className="text-body leading-relaxed text-ink-2">{t("verify.intro")}</p>
          <IdentityForm />
        </>
      )}
    </>
  );
}
