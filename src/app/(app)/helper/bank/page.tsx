import { notFound } from "next/navigation";
import { FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { myPayout } from "@/lib/payout";
import { BankForm } from "./bank-form";
import { unverifiedHelpersTestMode } from "@/lib/helper-test-mode";

/** /helper/bank — the helper's bank account: shown masked, and changed here (approved helpers only). */
export default async function BankPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  if (!viewer.actor.helperApproved || (unverifiedHelpersTestMode && viewer.profile.test_helper)) notFound();
  const [t, current] = await Promise.all([getT(), myPayout(viewer.profile.id)]);
  return (
    <>
      <FlowHeader href="/profile" label={t("common.back")} title={t("payout.title")} />
      {current ? (
        <section className="flex flex-col gap-1 rounded-card bg-bg p-4 shadow-card">
          <p className="text-[13px] text-ink-2">{t("payout.current")}</p>
          <p className="text-[17px] font-bold">
            {current.bank} · <span className="tabular-nums">{current.masked}</span>
          </p>
          <p className="text-[14px]">{current.holderName}</p>
          {!current.verified && <p className="text-[13px] text-warn">{t("payout.unchecked")}</p>}
        </section>
      ) : (
        <Note tone="warn">{t("payout.needed")}</Note>
      )}
      <section className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
        <h2 className="text-[16px] font-bold">{current ? t("payout.change") : t("payout.add")}</h2>
        <p className="text-[14px] text-ink-2">{t("payout.why")}</p>
        <BankForm next={current ? "profile" : "jobs"} holder={viewer.profile.verified_name ?? ""} />
      </section>
    </>
  );
}
