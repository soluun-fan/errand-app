import { redirect } from "next/navigation";
import { FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { latestApplication } from "@/lib/kyc";
import { isPaused } from "@/lib/safety";
import { ApplyForm } from "./apply-form";
import { TestHelperForm } from "./test-helper-form";
import { canUseUnverifiedHelperTest, unverifiedHelpersTestMode } from "@/lib/helper-test-mode";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("kyc.title");

/** /helper/apply — verification form, or the status of the latest application. */
export default async function ApplyPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  if (viewer.actor.helperApproved) redirect("/jobs");
  if (unverifiedHelpersTestMode) {
    const t = await getT();
    return (
      <>
        <FlowHeader href="/jobs" label={t("common.back")} title={t("kyc.testTitle")} />
        <Note tone="warn">{t("kyc.testWarning")}</Note>
        <TestHelperForm allowed={canUseUnverifiedHelperTest()} />
      </>
    );
  }
  const [t, app] = await Promise.all([getT(), latestApplication(viewer.profile.id)]);
  const canApply = !app || app.status === "changes_requested" || app.status === "rejected";

  return (
    <>
      <FlowHeader href="/jobs" label={t("common.back")} title={t("kyc.title")} />
      {/* approved but not working (helpers with a working account never reach this page): say why, never "you can take jobs now" */}
      {app?.status === "approved" ? (
        <Note tone="warn">
          <span className="block font-semibold">{t("kyc.approvedNotActive")}</span>
          <span className="mt-1 block">
            {viewer.profile.role === "admin"
              ? t("kyc.approvedButAdmin")
              : isPaused(viewer.profile)
                ? t("safety.accountPaused")
                : t("kyc.approvedAskOps")}
          </span>
        </Note>
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
          <p className="text-lead text-ink-2">{t("kyc.intro")}</p>
          <ApplyForm />
        </>
      )}
    </>
  );
}
