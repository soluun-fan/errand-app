import Link from "next/link";
import { ClipboardList, Plus, RotateCcw, ShieldCheck, Undo2 } from "lucide-react";
import { DealCard } from "@/components/deal-card";
import { EmptyState, btn, pageTitle } from "@/components/ui";
import { TERMINAL_STATUSES } from "@/lib/engine";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { listMyTasks, walletEntries } from "@/lib/deals/queries";
import { firstPhotoUrls } from "@/lib/task-photos";
import { kindCovers } from "@/lib/covers";
import { fmtMoney } from "@/lib/format";

const REFUND_KINDS = ["refund", "budget_refund"];
/** Past tasks shown straight away; the rest open in place. */
const PAST_SHOWN = 10;

/**
 * Даалгавар — the customer's tasks tab (2026-11-24, moved off Home so Home stays short): live tasks,
 * the money we hold for them and what came back, then recent past tasks with "Order again".
 */
export default async function TasksPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [t, locale, all, entries, covers] = await Promise.all([getT(), getLocale(), listMyTasks(viewer.profile.id), walletEntries(viewer.profile.id), kindCovers()]);
  const active = all.filter((x) => !TERMINAL_STATUSES.includes(x.deal.status));
  const past = all.filter((x) => TERMINAL_STATUSES.includes(x.deal.status));
  const holding = all.filter((x) => x.deal.heldAmount > 0);
  const heldNow = holding.reduce((a, x) => a + x.deal.heldAmount, 0);
  const refunds = entries.filter((e) => REFUND_KINDS.includes(e.kind) && e.amount > 0).reduce((a, e) => a + e.amount, 0);
  const ownPics = await firstPhotoUrls(past.map((x) => x.deal.id));

  const pastRow = (x: (typeof past)[number]) => (
    <DealCard
      key={x.deal.id}
      deal={x.deal}
      t={t}
      locale={locale}
      thumb={ownPics.get(x.deal.id) ?? covers.get(x.deal.category) ?? null}
      row
      rowAction={
        <Link href={`/post?again=${x.deal.id}`} className="flex min-h-11 items-center gap-1.5 text-[14px] font-semibold text-brand-ink">
          <RotateCcw aria-hidden size={16} /> {t("deal.postAgain")}
        </Link>
      }
    />
  );

  return (
    <>
      <h1 className={pageTitle}>{t("tabs.tasks")}</h1>

      {all.length === 0 && (
        <EmptyState
          icon={<ClipboardList aria-hidden size={28} />}
          title={t("tasksTab.empty")}
          body={t("tasksTab.emptyBody")}
          action={
            <Link href="/post" className={`${btn.primary} px-6`}>
              <Plus aria-hidden size={20} strokeWidth={2.5} /> {t("home.postCta")}
            </Link>
          }
        />
      )}

      {active.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[17px] font-bold">{t("tasksTab.active")}</h2>
          {active.map((x) => (
            <DealCard key={x.deal.id} deal={x.deal} offerCount={x.offerCount} t={t} locale={locale} />
          ))}
        </section>
      )}

      {(heldNow > 0 || refunds > 0) && (
        <div className={`grid gap-2.5 ${heldNow > 0 && refunds > 0 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
          {heldNow > 0 && (
            <div className="flex flex-col gap-1 rounded-card bg-held-bg p-4 text-held">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <ShieldCheck aria-hidden size={16} /> {t("wallet.heldNow")}
              </span>
              <span className="text-[20px] font-bold tabular-nums">{fmtMoney(heldNow)}</span>
              <span className="text-[13px]">{t("wallet.heldNowSub", { n: holding.length })}</span>
            </div>
          )}
          {refunds > 0 && (
            <div className="flex flex-col gap-1 rounded-card bg-bg p-4 shadow-card">
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink-2">
                <Undo2 aria-hidden size={16} /> {t("wallet.refunds")}
              </span>
              <span className="text-[20px] font-bold tabular-nums">{fmtMoney(refunds)}</span>
              <span className="text-[13px] text-ink-2">{t("wallet.refundsSub")}</span>
            </div>
          )}
        </div>
      )}

      {past.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-bold">{t("home.past")}</h2>
          <div className="flex flex-col rounded-card bg-bg px-4 shadow-card">
            {past.slice(0, PAST_SHOWN).map(pastRow)}
            {past.length > PAST_SHOWN && (
              <details className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center text-[14px] font-semibold text-brand-ink">
                  <span className="group-open:hidden">{t("home.pastAll", { n: past.length })}</span>
                  <span className="hidden group-open:inline">{t("home.pastLess")}</span>
                </summary>
                {past.slice(PAST_SHOWN).map(pastRow)}
              </details>
            )}
          </div>
        </section>
      )}
    </>
  );
}
