import Link from "next/link";
import { Avatar, Card, EmptyState } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";

/**
 * Helper mode home. Approved helpers get the job feed (CLAUDE.md §10 step 4, next);
 * everyone else sees the verification checklist (UI-FLOWS H1) with honest statuses.
 */
export default async function JobsPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const t = await getT();
  const { profile, actor } = viewer;

  const header = (
    <header className="flex items-center justify-between pt-2">
      <h1 className="text-[28px] font-bold">{actor.helperApproved ? t("tabs.jobs") : t("helper.becomeTitle")}</h1>
      <Link href="/profile" aria-label={t("home.profile")}>
        <Avatar name={profile.name || "?"} size={44} />
      </Link>
    </header>
  );
  if (actor.helperApproved)
    return (
      <>
        {header}
        <EmptyState icon="🧭" title={t("tabs.jobs")} body={t("helper.jobsSoon")} />
      </>
    );

  const pending = profile.helper_status === "pending";
  const chip = (state: "done" | "inReview" | "needed") => (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        state === "done" ? "bg-held-bg text-held" : state === "inReview" ? "bg-warn-bg text-warn" : "bg-fill text-ink-2"
      }`}
    >
      {t(`helper.${state}`)}
    </span>
  );
  const rows: [string, "done" | "inReview" | "needed"][] = [
    [t("helper.stepPhone"), profile.phone ? "done" : "needed"],
    [t("helper.stepDan"), profile.kyc_level >= 2 ? "done" : pending ? "inReview" : "needed"],
    [t("helper.stepSelfie"), profile.kyc_level >= 3 ? (pending ? "inReview" : "done") : "needed"],
    [t("helper.stepPayout"), profile.kyc_level >= 3 ? (pending ? "inReview" : "done") : "needed"],
  ];

  return (
    <>
      {header}
      <p className="text-[16px] text-ink-2">{t("helper.becomeBody")}</p>
      <Card>
        <h2 className="font-bold">{t("helper.checklist")}</h2>
        <ul className="flex flex-col divide-y divide-line">
          {rows.map(([label, state]) => (
            <li key={label} className="flex min-h-12 items-center justify-between gap-3">
              <span className="text-[15px]">{label}</span>
              {chip(state)}
            </li>
          ))}
        </ul>
        {pending && <p className="text-sm text-ink-2">{t("helper.pendingBody")}</p>}
      </Card>
    </>
  );
}
