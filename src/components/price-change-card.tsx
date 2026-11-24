import type { ReactNode } from "react";
import type { T } from "@/i18n";
import type { ErrandDeal } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";
import { InlineAction } from "./inline-action";
import { ConfirmSheet, type FormAction } from "./sheet";
import { btn, field, fieldLabel } from "./ui";

/**
 * Changing the price after matching (docs/decisions.md 2026-11-16), the same card on the customer's
 * task screen and the helper's job screen. One side proposes, the other accepts, declines or answers
 * with another price. Lower → refunded at once; higher → the customer pays the difference first
 * (`pay` is the customer's pay button for that, null for the helper).
 */
export function PriceChangeCard({
  deal,
  me,
  otherName,
  action,
  pay,
  t,
}: {
  deal: ErrandDeal;
  me: "customer" | "helper";
  otherName: string;
  action: FormAction;
  pay: ReactNode | null;
  t: T;
}) {
  if (deal.status !== "matched" && deal.status !== "in_progress" && deal.status !== "check") return null;
  // after "done" (2026-11-24): settle a problem between you first — only a lower price, by agreement
  const settle = deal.status === "check";
  const fields = { dealId: deal.id };
  const pc = deal.priceChange && deal.priceChange.status !== "paid" ? deal.priceChange : null;
  const proposeSheet = (label: string, start: number) => (
    <ConfirmSheet
      action={action}
      fields={{ ...fields, intent: "propose_price" }}
      trigger={label}
      triggerClass={`${btn.text} min-h-10 px-1 text-brand-ink`}
      title={settle ? t("settle.title") : t("priceChange.title")}
      body={settle ? t(me === "customer" ? "settle.bodyCustomer" : "settle.bodyHelper", { amount: fmtMoney(deal.fee), name: otherName }) : t("priceChange.body", { amount: fmtMoney(deal.fee), name: otherName })}
      confirmLabel={t("price.counterSend")}
    >
      <label className={fieldLabel}>
        {t("priceChange.newPrice")}
        <input name="price" inputMode="numeric" defaultValue={String(start)} className={`${field} text-[20px] font-bold tabular-nums`} required />
      </label>
    </ConfirmSheet>
  );

  if (!pc) {
    if (settle) {
      // a sensible first offer: 20% off, rounded to 500₮
      const start = Math.max(0, Math.round((deal.fee * 0.8) / 500) * 500);
      return <div className="flex justify-center">{proposeSheet(t(me === "customer" ? "settle.offer" : "settle.offerHelper"), start)}</div>;
    }
    return <div className="flex justify-center">{proposeSheet(t("priceChange.propose"), deal.fee)}</div>;
  }

  const mine = pc.by === me;
  const diff = pc.fee - deal.fee;
  return (
    <section className="flex flex-col gap-2 rounded-card border-2 border-brand bg-bg p-4 shadow-card" aria-live="polite">
      <h2 className="text-[13px] font-semibold text-ink-2">{t("priceChange.title")}</h2>
      {pc.status === "awaiting_payment" ? (
        <>
          <p className="text-[16px] font-semibold">{t("priceChange.agreed", { amount: fmtMoney(pc.fee), from: fmtMoney(deal.fee) })}</p>
          <p className="text-[14px] text-ink-2">
            {me === "customer" ? t("priceChange.payDiff", { amount: fmtMoney(diff) }) : t("priceChange.waitPay", { amount: fmtMoney(diff) })}
          </p>
          {pay}
          <InlineAction action={action} fields={{ ...fields, intent: "withdraw_price" }} label={t("priceChange.drop")} className={`${btn.text} self-center`} />
        </>
      ) : mine ? (
        <>
          <p className="text-[16px] font-semibold">{t("priceChange.youProposed", { amount: fmtMoney(pc.fee), from: fmtMoney(deal.fee) })}</p>
          <p className="text-[14px] text-ink-2">{t("priceChange.waiting", { name: otherName })}</p>
          {settle && <p className="text-[13px] text-ink-2">{t("settle.deadline")}</p>}
          <InlineAction action={action} fields={{ ...fields, intent: "withdraw_price" }} label={t("priceChange.withdraw")} className={`${btn.text} self-center`} />
        </>
      ) : (
        <>
          <p className="text-[16px] font-semibold">{t("priceChange.theyPropose", { name: otherName, amount: fmtMoney(pc.fee), from: fmtMoney(deal.fee) })}</p>
          <p className="text-[14px] text-ink-2">
            {deal.payMode === "direct"
              ? t("direct.priceNote", { amount: fmtMoney(pc.fee) })
              : diff < 0
                ? t("priceChange.lowerNote", { amount: fmtMoney(-diff) })
                : t("priceChange.higherNote", { amount: fmtMoney(diff) })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <InlineAction action={action} fields={{ ...fields, intent: "answer_price", accept: "0" }} label={t("priceChange.decline")} className={`${btn.secondary} w-full`} />
            <InlineAction action={action} fields={{ ...fields, intent: "answer_price", accept: "1" }} label={t("priceChange.accept")} className={`${btn.small} w-full`} />
          </div>
          <div className="flex justify-center">{proposeSheet(t("priceChange.answerOther"), pc.fee)}</div>
          {settle && <p className="text-[13px] text-ink-2">{t("settle.deadline")}</p>}
        </>
      )}
    </section>
  );
}
