import Link from "next/link";
import { Note, btn, pageTitle } from "@/components/ui";
import { CategoryIcon } from "@/components/category-icon";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmSheet } from "@/components/sheet";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { listMyJobs } from "@/lib/deals/queries";
import { errandSplit } from "@/lib/engine";
import { fmtDateTime, fmtMoney, ubMonthKey } from "@/lib/format";
import { myPayout } from "@/lib/payout";
import { earningsSummary } from "@/lib/withdrawals";
import { pendingEarningsStage } from "@/lib/earnings-rules";
import { withdrawAction } from "./actions";
import { unverifiedHelpersTestMode } from "@/lib/helper-test-mode";

/**
 * Орлого — the helper's earnings (owner's V1 Master Spec C10): what we owe them for finished jobs,
 * withdrawn in full to their own bank account. Never a "wallet" or "balance": it can't be spent or
 * sent in the app, only withdrawn.
 */
export default async function EarningsPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [t, locale, jobs, sum, account] = await Promise.all([getT(), getLocale(), listMyJobs(viewer.profile.id), earningsSummary(viewer.profile.id), myPayout(viewer.profile.id)]);
  const net = (d: (typeof jobs)[number]) => errandSplit({ fee: d.fee, itemBudget: 0, receipt: null, serviceFee: d.serviceFee, commissionBps: d.commissionBps }).helperFeeNet;
  const finished = jobs.filter((d) => d.status === "released" && !d.payeeOrgId);
  // older fee-only tasks: the customer paid the helper directly, so the app owes nothing for them
  const viaApp = (d: (typeof jobs)[number]) => d.payMode !== "direct";
  const now = Date.now();
  const pending = jobs.flatMap((job) => {
    const stage = pendingEarningsStage(job, now);
    return stage ? [{ job, stage }] : [];
  });
  const canWithdraw = sum.available >= sum.minimum && sum.available > 0 && sum.accountChecked;
  const testHelper = unverifiedHelpersTestMode && viewer.profile.test_helper;
  // this calendar month (Ulaanbaatar) — a quick sense of how the month is going
  const thisMonth = ubMonthKey(now);
  const monthJobs = finished.filter((d) => viaApp(d) && ubMonthKey(d.createdAt) === thisMonth);
  const monthTotal = monthJobs.reduce((a, d) => a + net(d), 0);
  const pill: Record<string, string> = { sent: "bg-held-bg text-held", failed: "bg-danger-bg text-danger", requested: "bg-warn-bg text-warn" };

  // one payout: status pill + amount, bank and date; the references fold under "Details"
  const payoutRow = (w: (typeof sum.recent)[number]) => (
    <div key={w.id} className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${pill[w.status] ?? "bg-fill text-ink-2"}`}>
          {t(`earnings.status.${w.status}`)}
          {w.auto ? ` · ${t("earnings.auto")}` : ""}
        </span>
        <span className="flex-1" />
        <span className={`font-bold tabular-nums ${w.status === "failed" ? "text-ink-3 line-through" : ""}`}>{fmtMoney(w.amount)}</span>
      </div>
      <span className="text-sm text-ink-2">{w.bank} {w.account} · {fmtDateTime(w.decidedAt ?? w.requestedAt, locale)}</span>
      <details className="text-sm text-ink-2">
        <summary className="inline-flex min-h-9 cursor-pointer items-center font-medium">{t("earnings.details")}</summary>
        <span className="block">{t("earnings.requestedAt", { time: fmtDateTime(w.requestedAt, locale) })}</span>
        {w.status !== "requested" && w.decidedAt !== null && <span className="block">{t(w.status === "sent" ? "earnings.sentAt" : "earnings.failedAt", { time: fmtDateTime(w.decidedAt, locale) })}</span>}
        <span className="block break-words">{w.reference}</span>
        {w.bankReference && <span className="block break-words">{t("earnings.bankReference", { reference: w.bankReference })}</span>}
      </details>
    </div>
  );
  const jobRow = (d: (typeof finished)[number]) => (
    <Link key={d.id} href={`/jobs/${d.id}`} className="press flex items-center gap-3 border-b border-line py-3 last:border-b-0">
      <CategoryIcon id={d.category} tile size={20} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{d.title}</span>
        <span className="block text-sm text-ink-2">{fmtDateTime(d.createdAt, locale)}</span>
      </span>
      {viaApp(d) ? (
        <span className="font-bold tabular-nums text-held">+{fmtMoney(net(d))}</span>
      ) : (
        <span className="text-right text-[13px] text-ink-2">
          {fmtMoney(net(d))}
          <span className="block">{t("earnings.paidDirectly")}</span>
        </span>
      )}
    </Link>
  );

  return (
    <>
      <h1 className={pageTitle}>{t("earnings.title")}</h1>
      {(pending.length > 0 || sum.onTheWay > 0) && <AutoRefresh seconds={30} />}
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-card bg-held-bg p-4 text-held">
          <span className="text-sm font-medium">{t("earnings.available")}</span>
          <span className="break-words text-[26px] font-bold tabular-nums text-brand-ink">{fmtMoney(sum.available)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-card bg-fill p-4">
          <span className="text-sm font-medium text-ink-2">{t("earnings.queued")}</span>
          <span className="break-words text-[26px] font-bold tabular-nums">{fmtMoney(sum.onTheWay)}</span>
        </div>
      </div>
      {sum.onTheWay > 0 && <Note tone="info">{t("earnings.onTheWay", { amount: fmtMoney(sum.onTheWay) })}</Note>}

      {account ? (
        canWithdraw ? (
          <ConfirmSheet
            action={withdrawAction}
            fields={{}}
            trigger={t("earnings.withdraw", { amount: fmtMoney(sum.available) })}
            triggerClass={`${btn.primary} w-full`}
            title={t("earnings.withdrawTitle", { amount: fmtMoney(sum.available) })}
            body={t("earnings.withdrawBody", { bank: account.bank, account: account.masked })}
            confirmLabel={t("earnings.withdrawConfirm")}
          >
            <p className="text-[13px] text-ink-2">{t("earnings.withdrawWhen")}</p>
          </ConfirmSheet>
        ) : (
          <p className="text-[14px] text-ink-2">
            {!sum.accountChecked
              ? t("earnings.err.unchecked")
              : t("earnings.minimum", { amount: fmtMoney(sum.minimum) })}
          </p>
        )
      ) : testHelper ? (
        <Note tone="warn">{t("earnings.testNoPayout")}</Note>
      ) : (
        <Link href="/helper/bank" className={`${btn.primary} w-full`}>
          {t("payout.add")}
        </Link>
      )}
      <p className="text-[13px] text-ink-2">{t("earnings.rules", { n: sum.perDay, days: sum.autoPayoutDays })}</p>
      {jobs.some((d) => d.payeeOrgId) && <Note tone="info">{t("org.workerPay")}</Note>}

      {pending.length > 0 && (
        <section className="flex flex-col">
          <h2 className="font-bold">{t("earnings.pendingJobs")}</h2>
          <p className="mb-2 mt-1 text-[13px] text-ink-2">{t("earnings.pendingExplain")}</p>
          <div className="rounded-card bg-bg px-4 shadow-card">
          {pending.map(({ job, stage }) => (
            <Link key={job.id} href={`/jobs/${job.id}`} className="press flex min-h-12 items-center gap-3 border-b border-line py-3 last:border-b-0">
              <CategoryIcon id={job.category} tile size={20} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="block truncate font-semibold">{job.title}</span>
                <span className={`block text-sm ${stage === "disputed" || stage === "overdue" ? "text-warn" : "text-ink-2"}`}>{t(`earnings.stage.${stage}`)}</span>
                {job.status === "check" && job.checkUntil !== null && (
                  <span className="block text-[13px] text-ink-2">{t("earnings.reviewUntil", { time: fmtDateTime(job.checkUntil, locale) })}</span>
                )}
              </span>
              <span className="shrink-0 font-bold tabular-nums">{fmtMoney(net(job))}</span>
            </Link>
          ))}
          </div>
        </section>
      )}

      {sum.recent.length > 0 && (
        <section className="flex flex-col">
          <h2 className="mb-2 font-bold">{t("earnings.history")}</h2>
          <div className="rounded-card bg-bg px-4 shadow-card">
            {sum.recent.slice(0, 3).map(payoutRow)}
            {sum.recent.length > 3 && (
              <details className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center font-semibold text-brand-ink group-open:hidden">{t("web.seeAll")} ({sum.recent.length})</summary>
                {sum.recent.slice(3).map(payoutRow)}
              </details>
            )}
          </div>
        </section>
      )}

      {finished.length > 0 && (
        <section className="flex flex-col">
          <h2 className="font-bold">{t("earnings.finished")}</h2>
          <p className="mb-2 text-[13px] text-ink-2">{t("earnings.thisMonth", { amount: fmtMoney(monthTotal), n: monthJobs.length })}</p>
          <div className="rounded-card bg-bg px-4 shadow-card">
            {finished.slice(0, 8).map(jobRow)}
            {finished.length > 8 && (
              <details className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center font-semibold text-brand-ink group-open:hidden">{t("web.seeAll")} ({finished.length})</summary>
                {finished.slice(8).map(jobRow)}
              </details>
            )}
          </div>
        </section>
      )}
    </>
  );
}
