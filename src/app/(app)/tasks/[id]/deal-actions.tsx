import { ReviewPhotoPicker } from "@/components/review-photo-picker";
import { ConfirmSheet } from "@/components/sheet";
import { btn, field, fieldLabel } from "@/components/ui";
import { amountDue, categoryTrust, errandSplit, helperLate, invitedOnly } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";
import { CANCEL_REASONS, DISPUTE_REASONS, RATING_TAGS } from "@/lib/labels";
import Link from "next/link";
import type { ReactNode } from "react";
import { MockQr } from "./mock-qr";
import { PaySheet } from "./pay-sheet";

import type { DealViewProps } from "./deal-view-types";
export function customerActions(p: DealViewProps, helperName: string, payeeName: string): { primary: ReactNode; secondary: ReactNode[] } {
  const { deal, t, serverNow } = p;
  const isCustomer = deal.customerId === p.viewerId;
  const care = categoryTrust(deal.category) === "care";
  const direct = deal.payMode === "direct";
  const fields = { dealId: deal.id };
  const topUpPending = deal.status === "in_progress" && deal.topUp?.status === "pending" ? deal.topUp : null;
  const split = errandSplit({
    fee: deal.fee,
    itemBudget: deal.itemBudget,
    receipt: deal.receiptAmount,
    serviceFee: deal.serviceFee,
    commissionBps: deal.commissionBps,
  });
  const againLink = (cls: string) => (
    <Link key="again" href={`/post?again=${deal.id}`} className={cls}>
      {t("deal.postAgain")}
    </Link>
  );
  /* ---------- primary + secondary actions (customer only) ---------- */
  // why the customer cancels (optional) — Ops sees it on the timeline (2026-11-22)
  const cancelReasons = (
    <label className={fieldLabel}>
      {t("cancelReason.label")}
      <select name="reason" defaultValue="" className={field}>
        <option value="">{t("cancelReason.skip")}</option>
        {CANCEL_REASONS.map((r) => (
          <option key={r} value={r}>
            {t(`cancelReason.${r}`)}
          </option>
        ))}
      </select>
    </label>
  );
  let primary: ReactNode = null;
  const secondary: ReactNode[] = [];
  if (isCustomer) {
    switch (deal.status) {
      case "awaiting_payment":
        primary = (
          <PaySheet
            dealId={deal.id}
            amountLabel={fmtMoney(amountDue(deal))}
            payBy={deal.payBy}
            serverNow={serverNow}
            defaultOpen={p.autoOpenPay}
            mock={p.mockPay}
            wire={p.wirePay}
            doneLabel={direct ? t("pay.feeDone") : undefined}
            action={p.action}
            qr={<MockQr seed={deal.id} />}
          />
        );
        secondary.push(
          <ConfirmSheet
            key="cancel"
            action={p.action}
            fields={{ ...fields, intent: "cancel" }}
            trigger={t("deal.cancel")}
            triggerClass={btn.text}
            title={t("deal.cancelFreeTitle")}
            body={t("deal.cancelUnpaidBody")}
            confirmLabel={t("deal.cancel")}
            confirmClass={btn.danger}
          >
            {cancelReasons}
          </ConfirmSheet>,
        );
        break;
      case "open":
        if (!care && invitedOnly(deal, serverNow) !== null) {
          secondary.push(
            <ConfirmSheet
              key="open_to_all"
              action={p.action}
              fields={{ ...fields, intent: "open_to_all" }}
              trigger={t("invite.openNow")}
              triggerClass={btn.text}
              title={t("invite.openNowTitle")}
              body={t("invite.openNowBody")}
              confirmLabel={t("invite.openNow")}
            />,
          );
        }
        secondary.push(
          <ConfirmSheet
            key="cancel"
            action={p.action}
            fields={{ ...fields, intent: "cancel" }}
            trigger={t("deal.cancel")}
            triggerClass={btn.text}
            title={t("deal.cancelFreeTitle")}
            body={deal.heldAmount > 0 ? t("deal.cancelFreeBody", { amount: fmtMoney(deal.heldAmount) }) : t("deal.cancelUnpaidBody")}
            confirmLabel={t("deal.cancel")}
            confirmClass={btn.danger}
          >
            {cancelReasons}
          </ConfirmSheet>,
        );
        break;
      case "in_progress":
        if (topUpPending) {
          primary = (
            <PaySheet
              dealId={deal.id}
              amountLabel={fmtMoney(topUpPending.amount)}
              payBy={null}
              serverNow={serverNow}
              defaultOpen={false}
              mock={p.mockPay}
              wire={p.wirePay}
              action={p.action}
              qr={<MockQr seed={`${deal.id}-topup`} />}
              intent="simulate_topup"
              triggerLabel={t("deal.topUp.approve", { amount: fmtMoney(topUpPending.amount) })}
            />
          );
          secondary.push(
            <ConfirmSheet
              key="decline"
              action={p.action}
              fields={{ ...fields, intent: "decline_topup" }}
              trigger={t("deal.topUp.decline")}
              triggerClass={btn.text}
              title={t("deal.topUp.declineTitle", { amount: fmtMoney(topUpPending.amount) })}
              body={t("deal.topUp.declineBody", { helper: helperName })}
              confirmLabel={t("deal.topUp.declineConfirm")}
              confirmClass={btn.danger}
            />,
          );
        }
        break;
      case "matched":
        // helper standards (2026-11-22): a helper who hasn't come — get another one, or cancel free
        if (helperLate(deal, serverNow)) {
          primary = (
            <ConfirmSheet
              action={p.action}
              fields={{ ...fields, intent: "replace_helper" }}
              trigger={t("standards.replace")}
              triggerClass={btn.primary}
              title={t("standards.replaceTitle")}
              body={t("standards.replaceBody", { helper: helperName, amount: fmtMoney(deal.heldAmount) })}
              confirmLabel={t("standards.replace")}
            />
          );
          secondary.push(
            <ConfirmSheet
              key="cancel"
              action={p.action}
              fields={{ ...fields, intent: "cancel" }}
              trigger={t("standards.cancelFree")}
              triggerClass={btn.textDanger}
              title={t("deal.cancelFreeTitle")}
              body={t("deal.cancelFreeBody", { amount: fmtMoney(deal.heldAmount) })}
              confirmLabel={t("deal.cancel")}
              confirmClass={btn.danger}
            >
              {cancelReasons}
            </ConfirmSheet>,
          );
          break;
        }
        secondary.push(
          <ConfirmSheet
            key="cancel"
            action={p.action}
            fields={{ ...fields, intent: "cancel" }}
            trigger={t("deal.cancel")}
            triggerClass={btn.textDanger}
            title={t("deal.cancelFeeTitle")}
            body={t("deal.cancelFeeBody", {
              fee: fmtMoney(deal.cancelFee),
              helper: helperName,
              refund: fmtMoney(deal.heldAmount - deal.cancelFee),
            })}
            confirmLabel={t("deal.cancel")}
            confirmClass={btn.danger}
          >
            {cancelReasons}
          </ConfirmSheet>,
        );
        break;
      case "check":
        primary = (
          <ConfirmSheet
            action={p.action}
            fields={{ ...fields, intent: "confirm" }}
            trigger={t("deal.confirmDone")}
            triggerClass={`${btn.primary} w-full`}
            title={t("deal.confirmTitle")}
            body={
              split.refund > 0
                ? t("deal.confirmBodyRefund", { helper: payeeName, net: fmtMoney(split.helperNet), refund: fmtMoney(split.refund) })
                : t("deal.confirmBody", { helper: payeeName, net: fmtMoney(split.helperNet) })
            }
            confirmLabel={t("deal.confirmDone")}
          />
        );
        secondary.push(
          <ConfirmSheet
            key="dispute"
            action={p.action}
            fields={{ ...fields, intent: "dispute" }}
            trigger={t("deal.problem")}
            triggerClass={btn.textDanger}
            title={t("dispute.title")}
            confirmLabel={t("dispute.submit")}
            confirmClass={btn.danger}
          >
            <fieldset className="flex flex-col">
              {DISPUTE_REASONS.map((r, i) => (
                <label key={r} className="flex min-h-11 items-center gap-3 text-[15px]">
                  <input type="radio" name="reason" value={r} defaultChecked={i === 0} className="h-5 w-5 accent-danger" />
                  {t(`dispute.reasons.${r}`)}
                </label>
              ))}
            </fieldset>
            <label className={fieldLabel}>
              {t("dispute.note")}
              <textarea name="note" required minLength={20} maxLength={1000} rows={3} className={field} placeholder={t("dispute.notePh")} />
            </label>
            <p className="rounded-input bg-warn-bg p-3 text-sm text-warn">{t(direct ? "direct.disputeWhat" : "dispute.what")}</p>
          </ConfirmSheet>,
        );
        break;
      case "released":
        if (p.rated === null && deal.helperId) {
          primary = (
            <ConfirmSheet
              action={p.action}
              fields={{ ...fields, intent: "rate" }}
              trigger={t("deal.rate", { name: helperName })}
              triggerClass={`${btn.primary} w-full`}
              title={t("rating.title", { name: helperName })}
              confirmLabel={t("rating.submit")}
            >
              <fieldset className="flex justify-center gap-1" aria-label={t("rating.title", { name: helperName })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="cursor-pointer">
                    <input type="radio" name="stars" value={n} required defaultChecked={n === 5} className="peer sr-only" />
                    <span
                      aria-label={t("rating.stars", { n })}
                      className="flex h-12 w-12 items-center justify-center rounded-input border border-line text-xl text-ink-3 peer-checked:border-2 peer-checked:border-ink peer-checked:text-warn peer-focus-visible:outline-2 peer-focus-visible:outline-ink"
                    >
                      ★{n}
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                {RATING_TAGS.map((tag) => (
                  <label key={tag} className="cursor-pointer">
                    <input type="checkbox" name="tags" value={tag} className="peer sr-only" />
                    <span className="inline-flex min-h-11 items-center rounded-full bg-fill px-4 text-[15px] peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-ink">
                      {t(`rating.tags.${tag}`)}
                    </span>
                  </label>
                ))}
              </div>
              <label className={fieldLabel}>
                {t("rating.note")}
                <textarea name="note" maxLength={500} rows={2} className={field} />
              </label>
              {/* no public photos of care work (children, elders) */}
              {categoryTrust(deal.category) !== "care" && <ReviewPhotoPicker dealId={deal.id} />}
              <p className="text-[13px] text-ink-2">{t("helperProfile.reviewPublic")}</p>
            </ConfirmSheet>
          );
          secondary.push(againLink(btn.text));
        } else {
          primary = againLink(`${btn.primary} w-full`);
        }
        break;
      case "refunded":
      case "cancelled":
      case "expired":
        primary = againLink(`${btn.primary} w-full`);
        break;
    }
  }

  return { primary, secondary };
}
