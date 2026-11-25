import { MoneyBreakdown, type MoneyRow } from "@/components/money-breakdown";
import type { T } from "@/i18n";
import { amountDue, errandSplit, type ErrandDeal } from "@/lib/engine";
import type { ReactNode } from "react";

export function DealMoney({ deal, payeeName, t }: { deal: ErrandDeal; payeeName: string; t: T }) {
  const direct = deal.payMode === "direct";
  const split = errandSplit({
    fee: deal.fee,
    itemBudget: deal.itemBudget,
    receipt: deal.receiptAmount,
    serviceFee: deal.serviceFee,
    commissionBps: deal.commissionBps,
  });
  /* ---------- money: where it is now ---------- */
  let money: ReactNode;
  if (direct && !["refunded", "cancelled", "expired"].includes(deal.status)) {
    // fee-only: what goes through the app now, and what the customer pays the helper themselves
    const done = ["check", "disputed", "released"].includes(deal.status);
    const rows: MoneyRow[] = [
      {
        label: t(done ? "direct.money.toHelperNow" : "direct.money.toHelperLater"),
        amount: done ? deal.fee + (deal.receiptAmount ?? 0) : deal.fee,
      },
    ];
    if (deal.itemBudget > 0 && !done) rows.push({ label: t("direct.money.itemsLater"), amount: deal.itemBudget, muted: true });
    rows.push({ label: t(deal.heldAmount > 0 || done ? "direct.money.feePaid" : "direct.money.feeNow"), amount: deal.serviceFee });
    money = (
      <MoneyBreakdown
        rows={rows}
        total={{ label: t(deal.status === "awaiting_payment" ? "direct.money.payNow" : "direct.money.feeTotal"), amount: deal.serviceFee }}
      />
    );
  } else if (["check", "disputed", "released"].includes(deal.status)) {
    const rows: MoneyRow[] = [
      {
        label: deal.payeeOrgId
          ? t("org.payee", { name: payeeName })
          : deal.commissionBps > 0
            ? t("money.toHelperFee", { pct: deal.commissionBps / 100 })
            : t("money.toHelper"),
        amount: split.helperFeeNet,
      },
    ];
    if (deal.itemBudget > 0) {
      rows.push({ label: deal.payeeOrgId ? t("org.payeeItems", { name: payeeName }) : t("money.toHelperItems"), amount: split.spent });
      rows.push({ label: t("money.backToYou"), amount: split.refund });
    }
    // the platform's fee is never the organisation's money, whoever did the job
    rows.push({
      label: deal.commissionBps > 0 ? t("money.platform") : deal.details.freeFirst ? t("post.firstTaskFree") : t("money.serviceFee"),
      amount: split.platform,
      muted: true,
    });
    money = <MoneyBreakdown rows={rows} total={{ label: t("money.totalHeld"), amount: split.held }} />;
  } else if (!["refunded", "cancelled", "expired"].includes(deal.status)) {
    const rows: MoneyRow[] = [{ label: t("money.helperFee"), amount: deal.fee }];
    if (deal.itemBudget > 0) rows.push({ label: t("money.itemBudget"), amount: deal.itemBudget });
    rows.push({ label: deal.details.freeFirst ? t("post.firstTaskFree") : t("money.serviceFee"), amount: deal.serviceFee, muted: true });
    money = (
      <MoneyBreakdown
        rows={rows}
        total={{ label: t("money.totalHeld"), amount: amountDue(deal) }}
        caption={deal.itemBudget > 0 ? t("money.itemBudgetNote") : undefined}
      />
    );
  }

  return <>{money}</>;
}
