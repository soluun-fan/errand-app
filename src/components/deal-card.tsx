import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import type { ReactNode } from "react";
import type { Locale, T } from "@/i18n";
import type { ErrandDeal } from "@/lib/engine/types";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { StatusBadge } from "./status-badge";

/** How far along a task is, for the live card's bar. */
const PROGRESS: Record<ErrandDeal["status"], number> = {
  open: 0.15,
  awaiting_payment: 0.3,
  matched: 0.45,
  in_progress: 0.7,
  check: 0.9,
  disputed: 0.9,
  released: 1,
  refunded: 1,
  cancelled: 1,
  expired: 1,
};

/** Live task card on Home (dark, progress bar) — or a compact list row (past tasks). */
export function DealCard({
  deal,
  offerCount = 0,
  t,
  locale,
  row = false,
  rowAction,
}: {
  deal: ErrandDeal;
  offerCount?: number;
  t: T;
  locale: Locale;
  row?: boolean;
  /** Row only: a button beside the row (e.g. "Дахин захиалах"); links can't nest inside the row link. */
  rowAction?: ReactNode;
}) {
  const when = deal.scheduledAt ? fmtDateTime(deal.scheduledAt, locale) : fmtDateTime(deal.createdAt, locale);
  if (row) {
    const link = (
      <Link href={`/tasks/${deal.id}`} className={`press flex items-center gap-3 py-3 ${rowAction ? "" : "border-b border-line last:border-b-0"}`}>
        <CategoryIcon id={deal.category} tile size={22} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{deal.title}</span>
          <span className="block text-[13px] text-ink-2">{when}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="text-[15px] font-bold tabular-nums text-brand-ink">{fmtMoney(deal.fee + deal.itemBudget + deal.serviceFee)}</span>
          <StatusBadge status={deal.status} t={t} />
        </span>
      </Link>
    );
    if (!rowAction) return link;
    return (
      <div className="flex flex-col border-b border-line pb-3 last:border-b-0">
        {link}
        <div className="flex justify-end">{rowAction}</div>
      </div>
    );
  }
  // live card (redesign): dark, one line of status, an orange progress bar, then the details
  return (
    <Link href={`/tasks/${deal.id}`} className="press flex flex-col gap-2.5 rounded-card bg-ink p-4 text-white shadow-float">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-white/12 px-2.5 py-1 text-[12px] font-semibold">{t(`status.${deal.status}`)}</span>
        <ChevronRight aria-hidden size={18} className="text-white/70" />
      </div>
      <b className="truncate text-[17px]">{deal.title}</b>
      <span className="h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden>
        <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(PROGRESS[deal.status] * 100)}%` }} />
      </span>
      <span className="flex items-center gap-1.5 text-[13px] text-white/75">
        <CategoryIcon id={deal.category} size={14} />
        {t(`categoryShort.${deal.category}`)} · {deal.scheduledAt ? when : t("task.whenNow")}
        {deal.status === "open" && deal.mode === "schedule" ? ` · ${t("deal.offers", { n: offerCount, max: deal.maxApplicants })}` : ""}
      </span>
    </Link>
  );
}
