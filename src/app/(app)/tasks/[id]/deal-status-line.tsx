import { Countdown } from "@/components/countdown";
import { amountDue, errandSplit, invitedOnly } from "@/lib/engine";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import type { ReactNode } from "react";

import type { DealViewProps } from "./deal-view-types";
export function DealStatusLine({ p, helperName, payeeName }: { p: DealViewProps; helperName: string; payeeName: string }) {
  const { deal, events, t, locale, serverNow, people } = p;
  const direct = deal.payMode === "direct";
  const name = (uid: unknown) =>
    typeof uid === "string" ? (people.get(uid)?.name ?? p.organizations?.get(uid)?.name ?? t("deal.newHelper")) : "—";
  const cancelFeePaid = events.find((e) => e.code === "cancel_fee_paid");
  const split = errandSplit({
    fee: deal.fee,
    itemBudget: deal.itemBudget,
    receipt: deal.receiptAmount,
    serviceFee: deal.serviceFee,
    commissionBps: deal.commissionBps,
  });
  let line: ReactNode;
  switch (deal.status) {
    case "awaiting_payment":
      line = deal.payBy ? (
        <Countdown
          until={deal.payBy}
          serverNow={serverNow}
          template={
            direct
              ? t("direct.line.awaiting", { helper: helperName, fee: fmtMoney(deal.serviceFee), time: "{time}" })
              : t("deal.line.awaiting_payment", { helper: helperName, time: "{time}" })
          }
        />
      ) : null;
      break;
    case "open":
      line =
        invitedOnly(deal, serverNow) !== null && deal.invite ? (
          // a direct request: waiting on the one helper the customer picked
          <>
            {t("invite.waiting", { name: name(deal.invite.helperId) })}{" "}
            {deal.invite.openAfter && <Countdown until={deal.invite.until} serverNow={serverNow} template={t("invite.opensIn")} />}
          </>
        ) : (
          <>
            {deal.mode === "now"
              ? deal.offers.length > 0
                ? t("deal.line.openChoose", { n: deal.offers.length })
                : p.dispatch?.notified
                  ? t("deal.line.openNow", { n: p.dispatch.notified })
                  : t("deal.line.openNowStart")
              : t("deal.line.openSchedule", { offers: deal.offers.length, max: deal.maxApplicants })}{" "}
            {deal.matchBy && t("deal.line.noMatchBy", { when: fmtDateTime(deal.matchBy, locale) })}
          </>
        );
      break;
    case "matched":
      line = direct ? t("direct.line.matched", { helper: helperName }) : t("deal.line.matched", { helper: helperName });
      break;
    case "in_progress":
      line = t("deal.line.in_progress", { helper: helperName });
      break;
    case "check":
      line = (
        <>
          {t("deal.line.check", { helper: helperName })}{" "}
          {deal.checkUntil && (
            <span className="mt-2 block">
              <Countdown until={deal.checkUntil} serverNow={serverNow} template={t("deal.autoConfirm")} pill />
            </span>
          )}
          <span className="mt-1.5 block text-small text-ink-2">{t("deal.autoConfirmInfo")}</span>
        </>
      );
      break;
    case "disputed":
      line = direct ? t("direct.line.disputed") : t("deal.line.disputed");
      break;
    case "released":
      line = direct
        ? t("direct.line.released", { helper: payeeName })
        : split.refund > 0
          ? t("deal.line.releasedRefund", { amount: fmtMoney(split.refund) })
          : t("deal.line.released", { helper: payeeName });
      break;
    case "refunded":
      line = direct
        ? t("direct.line.refunded", { amount: fmtMoney(deal.serviceFee) })
        : t("deal.line.refunded", { amount: fmtMoney(amountDue(deal)) });
      break;
    case "cancelled": {
      const kept = events.find((e) => e.code === "fee_kept");
      line =
        kept && cancelFeePaid
          ? // a paid task cancelled after choosing (2026-11-27): the helper's fee, our fee, the rest back
            t("deal.line.cancelledFeeKept", {
              fee: fmtMoney(Number(cancelFeePaid.data.amount ?? 0)),
              kept: fmtMoney(Number(kept.data.amount ?? 0)),
            })
          : kept
            ? t("direct.line.cancelledKept", { fee: fmtMoney(deal.serviceFee) })
            : cancelFeePaid
              ? deal.payeeOrgId
                ? t("org.cancelledFee", { fee: fmtMoney(Number(cancelFeePaid.data.amount ?? 0)), name: payeeName })
                : t("deal.line.cancelledFee", { fee: fmtMoney(Number(cancelFeePaid.data.amount ?? 0)) })
              : t("deal.line.cancelled");
      break;
    }
    case "expired": {
      // say why it ended: refunded (old paid-at-posting deals), the one invited helper said no,
      // the match wasn't paid in time, or simply nobody took it
      const declined = events.find((e) => e.code === "invite_declined");
      line = deal.paymentRef
        ? t("deal.line.expiredNoHelper", { amount: fmtMoney(amountDue(deal)) })
        : declined
          ? t("deal.line.expiredDeclined", { name: name(declined.data.helperId) })
          : events.some((e) => e.code === "payment_expired")
            ? t("deal.line.expiredUnpaid")
            : t("deal.line.expiredNobody");
      break;
    }
  }
  return <>{line}</>;
}
