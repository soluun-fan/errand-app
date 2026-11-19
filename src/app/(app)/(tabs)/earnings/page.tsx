import Link from "next/link";
import { Note, btn } from "@/components/ui";
import { CategoryIcon } from "@/components/category-icon";
import { ConfirmSheet } from "@/components/sheet";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { listMyJobs } from "@/lib/deals/queries";
import { errandSplit } from "@/lib/engine";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { myPayout } from "@/lib/payout";
import { earningsSummary } from "@/lib/withdrawals";
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
  const waiting = jobs.filter((d) => viaApp(d) && !d.payeeOrgId && ["matched", "in_progress", "check", "disputed"].includes(d.status)).reduce((a, d) => a + net(d), 0);
  const canWithdraw = sum.available >= sum.minimum && sum.available > 0 && sum.accountChecked;
  const testHelper = unverifiedHelpersTestMode && viewer.profile.test_helper;

  return (
    <>
      <h1 className="pt-2 text-[24px] font-bold tracking-tight">{t("earnings.title")}</h1>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-card bg-held-bg p-4 text-held">
          <span className="text-sm font-medium">{t("earnings.available")}</span>
          <span className="text-[26px] font-bold tabular-nums text-brand-ink">{fmtMoney(sum.available)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-card bg-fill p-4">
          <span className="text-sm font-medium text-ink-2">{t("earnings.waiting")}</span>
          <span className="text-[26px] font-bold tabular-nums">{fmtMoney(waiting)}</span>
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
      <p className="text-[13px] text-ink-2">{t("earnings.rules", { n: sum.perDay })}</p>
      {jobs.some((d) => d.payeeOrgId) && <Note tone="info">{t("org.workerPay")}</Note>}

      {sum.recent.length > 0 && (
        <section className="flex flex-col">
          <h2 className="mb-1 font-bold">{t("earnings.history")}</h2>
          {sum.recent.map((w) => (
            <div key={w.id} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {t(`earnings.status.${w.status}`)}
                  {w.auto ? ` · ${t("earnings.auto")}` : ""}
                </span>
                <span className="block text-sm text-ink-2">
                  {fmtDateTime(w.requestedAt, locale)} · {w.bank} {w.account} · {w.reference}
                </span>
              </span>
              <span className={`font-bold tabular-nums ${w.status === "failed" ? "text-ink-3 line-through" : ""}`}>{fmtMoney(w.amount)}</span>
            </div>
          ))}
        </section>
      )}

      {finished.length > 0 && (
        <section className="flex flex-col">
          <h2 className="mb-1 font-bold">{t("earnings.finished")}</h2>
          {finished.map((d) => (
            <a key={d.id} href={`/jobs/${d.id}`} className="press flex items-center gap-3 border-b border-line py-3 last:border-b-0">
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
            </a>
          ))}
        </section>
      )}
    </>
  );
}
