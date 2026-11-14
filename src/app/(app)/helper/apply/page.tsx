import { redirect } from "next/navigation";
import { FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { latestApplication } from "@/lib/kyc";
import { ApplyForm } from "./apply-form";

/** /helper/apply — verification form, or the status of the latest application. */
export default async function ApplyPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  if (viewer.actor.helperApproved) redirect("/jobs");
  const [t, app] = await Promise.all([getT(), latestApplication(viewer.profile.id)]);
  const canApply = !app || app.status === "changes_requested" || app.status === "rejected";

  return (
    <>
      <FlowHeader href="/jobs" label={t("common.back")} title={t("kyc.title")} />
      {app && (
        <Note tone={app.status === "submitted" ? "info" : app.status === "approved" ? "held" : "warn"}>
          <span className="block font-semibold">{t(`kyc.status.${app.status}`)}</span>
          {app.decisionNote && <span className="mt-1 block">{t("kyc.note", { note: app.decisionNote })}</span>}
        </Note>
      )}
      {canApply && (
        <>
          <p className="text-[16px] text-ink-2">{t("kyc.intro")}</p>
          <ApplyForm />
        </>
      )}
    </>
  );
}
