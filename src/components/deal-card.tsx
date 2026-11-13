import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale, T } from "@/i18n";
import type { ErrandDeal } from "@/lib/engine/types";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { CATEGORY_ICON } from "@/lib/labels";
import { StatusBadge } from "./status-badge";
import { StepTracker } from "./step-tracker";

/** Pinned active-deal card with a mini tracker (Home) — or a compact list row (History). */
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
        <span aria-hidden className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-fill text-2xl">
          {CATEGORY_ICON[deal.category]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-semibold">{deal.title}</span>
          <span className="block text-sm text-ink-2">{when}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="text-[15px] font-bold tabular-nums">{fmtMoney(deal.fee + deal.itemBudget + deal.serviceFee)}</span>
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
  return (
    <Link href={`/tasks/${deal.id}`} className="press flex flex-col gap-3 rounded-card border border-line bg-bg p-4 shadow-float">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="text-2xl">
            {CATEGORY_ICON[deal.category]}
          </span>
          <b className="truncate text-[17px]">{deal.title}</b>
        </span>
        <StatusBadge status={deal.status} t={t} />
      </div>
      <StepTracker status={deal.status} events={[]} t={t} compact />
      <div className="flex items-center justify-between text-sm text-ink-2">
        <span>
          {t(`categoryShort.${deal.category}`)} · {deal.scheduledAt ? when : t("task.whenNow")}
          {deal.status === "open" && deal.mode === "schedule" ? ` · ${t("deal.offers", { n: offerCount, max: deal.maxApplicants })}` : ""}
        </span>
        <span aria-hidden className="text-lg text-ink">
          ›
        </span>
      </div>
    </Link>
  );
}
