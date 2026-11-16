import { Note } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { listMyJobs, walletEntries } from "@/lib/deals/queries";
import { errandSplit } from "@/lib/engine";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { CATEGORY_ICON } from "@/lib/labels";

/** Орлого (helper) — available = released to you; waiting = your net on jobs not yet confirmed. */
export default async function EarningsPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [t, locale, jobs, entries] = await Promise.all([getT(), getLocale(), listMyJobs(viewer.profile.id), walletEntries(viewer.profile.id)]);
  const net = (d: (typeof jobs)[number]) => errandSplit({ fee: d.fee, itemBudget: 0, receipt: null, serviceFee: d.serviceFee, commissionBps: d.commissionBps }).helperFeeNet;
  const finished = jobs.filter((d) => d.status === "released");
  const available = entries.filter((e) => ["release_fee", "item_reimburse", "cancel_fee", "withdrawal"].includes(e.kind)).reduce((a, e) => a + e.amount, 0);
  const waiting = jobs
    .filter((d) => ["matched", "in_progress", "check", "disputed"].includes(d.status))
    .reduce((a, d) => a + errandSplit({ fee: d.fee, itemBudget: 0, receipt: null, serviceFee: d.serviceFee, commissionBps: d.commissionBps }).helperFeeNet, 0);

  return (
    <>
      <h1 className="pt-2 text-[28px] font-bold">{t("earnings.title")}</h1>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-card bg-held-bg p-4 text-held">
          <span className="text-sm font-medium">{t("earnings.available")}</span>
          <span className="text-[26px] font-bold tabular-nums text-brand-ink">{fmtMoney(available)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-card bg-fill p-4">
          <span className="text-sm font-medium text-ink-2">{t("earnings.waiting")}</span>
          <span className="text-[26px] font-bold tabular-nums">{fmtMoney(waiting)}</span>
        </div>
      </div>
      <Note tone="info">{t("earnings.withdrawSoon")}</Note>
      {finished.length > 0 && (
        <section className="flex flex-col">
          <h2 className="mb-1 font-bold">{t("earnings.finished")}</h2>
          {finished.map((d) => (
            <a key={d.id} href={`/jobs/${d.id}`} className="press flex items-center gap-3 border-b border-line py-3 last:border-b-0">
              <span aria-hidden className="text-2xl">
                {CATEGORY_ICON[d.category]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{d.title}</span>
                <span className="block text-sm text-ink-2">{fmtDateTime(d.createdAt, locale)}</span>
              </span>
              <span className="font-bold tabular-nums text-held">+{fmtMoney(net(d))}</span>
            </a>
          ))}
        </section>
      )}
    </>
  );
}
