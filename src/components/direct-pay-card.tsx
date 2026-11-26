import { CopyButton } from "@/components/copy-button";
import { InlineAction } from "@/components/inline-action";
import { ConfirmSheet, type FormAction } from "@/components/sheet";
import { Note, btn } from "@/components/ui";
import type { T } from "@/i18n";
import type { DirectPayState, PayeeAccount } from "@/lib/direct-pay";
import { fmtMoney } from "@/lib/format";

/**
 * Fee-only tasks (docs/decisions.md 2026-11-18 "Direct pay + wire.mn"): once the helper has finished,
 * the customer pays them directly — to the account shown, by QPay or in cash — and both sides mark it.
 */
export function DirectPayCustomerCard({
  dealId,
  payeeName,
  state,
  account,
  receipt,
  action,
  t,
}: {
  dealId: string;
  payeeName: string;
  state: DirectPayState;
  account: PayeeAccount | null;
  receipt: number | null;
  action: FormAction;
  t: T;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card" aria-label={t("direct.card.title", { name: payeeName })}>
      <div>
        <h2 className="font-bold">{t("direct.card.title", { name: payeeName })}</h2>
        <p className="text-display-sm font-extrabold tabular-nums text-brand-ink">{fmtMoney(state.amount)}</p>
        <p className="text-small text-ink-2">{receipt ? t("direct.card.withItems", { items: fmtMoney(receipt) }) : t("direct.card.sub")}</p>
      </div>
      {account ? (
        <dl className="flex flex-col gap-1.5 rounded-input bg-fill p-3 text-body">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">{t("direct.card.bank")}</dt>
            <dd className="font-semibold">{account.bank}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-2">{t("direct.card.account")}</dt>
            <dd className="flex items-center gap-2 font-semibold tabular-nums">
              {account.accountNumber} <CopyButton text={account.accountNumber} />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">{t("direct.card.holder")}</dt>
            <dd className="font-semibold">{account.holderName}</dd>
          </div>
        </dl>
      ) : (
        <Note tone="info">{t("direct.card.noAccount")}</Note>
      )}
      {state.unpaidReportedAt && !state.resolvedAt && !state.helperReceivedAt && <Note tone="warn">{t("direct.card.reported", { name: payeeName })}</Note>}
      {state.helperReceivedAt ? (
        <p className="font-semibold text-held">{t("direct.card.received", { name: payeeName })}</p>
      ) : state.customerPaidAt ? (
        <p className="text-small text-ink-2">{t("direct.card.paidDone")}</p>
      ) : (
        <InlineAction action={action} fields={{ dealId, intent: "direct_paid" }} label={t("direct.card.paid")} className={`${btn.primary} w-full`} />
      )}
    </section>
  );
}

export function DirectPayHelperCard({ dealId, state, action, t }: { dealId: string; state: DirectPayState; action: FormAction; t: T }) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card" aria-label={t("direct.helper.title", { amount: fmtMoney(state.amount) })}>
      <div>
        <h2 className="font-bold">{t("direct.helper.title", { amount: fmtMoney(state.amount) })}</h2>
        <p className="text-small text-ink-2">{t("direct.helper.sub")}</p>
      </div>
      {state.customerPaidAt && !state.helperReceivedAt && <Note tone="info">{t("direct.helper.customerMarked")}</Note>}
      {state.helperReceivedAt ? (
        <p className="font-semibold text-held">{t("direct.helper.receivedDone")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <InlineAction action={action} fields={{ dealId, intent: "direct_received" }} label={t("direct.helper.received")} className={`${btn.primary} w-full`} />
          {state.unpaidReportedAt && !state.resolvedAt ? (
            <p className="text-center text-small text-warn">{t("direct.helper.reported")}</p>
          ) : (
            <ConfirmSheet
              action={action}
              fields={{ dealId, intent: "direct_unpaid" }}
              trigger={t("direct.helper.notPaid")}
              triggerClass={`${btn.text} text-danger`}
              title={t("direct.helper.notPaidTitle")}
              body={t("direct.helper.notPaidBody")}
              confirmLabel={t("direct.helper.notPaid")}
              confirmClass={btn.danger}
            />
          )}
        </div>
      )}
    </section>
  );
}
