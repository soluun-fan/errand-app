import Link from "next/link";
import { EmptyState, Note } from "@/components/ui";
import type { MessageKey } from "@/i18n";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { listMyTasks, walletEntries } from "@/lib/deals/queries";
import { fmtDateTime, fmtMoney } from "@/lib/format";

const REFUND_KINDS = ["refund", "budget_refund"];

/** Хэтэвч — skeleton C (DESIGN §5.11). Everything here is read from the ledger. */
export default async function WalletPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [t, locale, tasks, entries] = await Promise.all([getT(), getLocale(), listMyTasks(viewer.profile.id), walletEntries(viewer.profile.id)]);
  const open = tasks.filter((x) => x.deal.heldAmount > 0);
  const heldNow = open.reduce((a, x) => a + x.deal.heldAmount, 0);
  const refunds = entries.filter((e) => REFUND_KINDS.includes(e.kind) && e.amount > 0).reduce((a, e) => a + e.amount, 0);

  return (
    <>
      <h1 className="pt-2 text-[28px] font-bold">{t("wallet.title")}</h1>
      <div className="grid grid-cols-2 gap-3">
        <Link href="/history" className="press flex flex-col gap-1 rounded-card bg-held-bg p-4 text-held">
          <span className="text-sm font-medium">🔒 {t("wallet.heldNow")}</span>
          <span className="text-[26px] font-bold tabular-nums">{fmtMoney(heldNow)}</span>
          <span className="text-sm">{t("wallet.heldNowSub", { n: open.length })}</span>
        </Link>
        <Link href="/history?tab=done" className="press flex flex-col gap-1 rounded-card bg-fill p-4">
          <span className="text-sm font-medium text-ink-2">↩ {t("wallet.refunds")}</span>
          <span className="text-[26px] font-bold tabular-nums">{fmtMoney(refunds)}</span>
          <span className="text-sm text-ink-2">{t("wallet.refundsSub")}</span>
        </Link>
      </div>

      <h2 className="pt-2 text-lg font-semibold">{t("wallet.transactions")}</h2>
      {entries.length ? (
        <ul className="flex flex-col">
          {entries.map((e, i) => (
            <li key={i} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-medium">{t(`wallet.kind.${e.kind}` as MessageKey)}</span>
                <span className="block text-sm text-ink-2">{fmtDateTime(e.at, locale)}</span>
              </span>
              <span className={`text-[16px] font-bold tabular-nums ${e.amount > 0 ? "text-held" : "text-ink"}`}>
                {e.amount > 0 ? "+" : "−"}
                {fmtMoney(Math.abs(e.amount))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="👛" title={t("wallet.empty")} />
      )}
      <Note tone="info">{t("wallet.banksSoon")}</Note>
    </>
  );
}
