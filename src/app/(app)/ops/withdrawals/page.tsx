import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { CopyButton } from "@/components/copy-button";
import { InlineAction } from "@/components/inline-action";
import { Card, FlowHeader, Note, btn, field, fieldLabel } from "@/components/ui";
import { ConfirmSheet } from "@/components/sheet";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { accountsToCheck, withdrawalQueue } from "@/lib/withdrawals";
import { checkAccountAction, decideWithdrawalAction } from "../actions";

/**
 * /ops/withdrawals — helpers' withdrawals to send from the bank app (owner's V1 Master Spec C10):
 * name, bank, account, amount and the PAYOUT reference with copy buttons; "Sent" once done.
 * Target: within 15 minutes in opening hours. Also: bank accounts to check against the ID.
 */
export default async function OpsWithdrawalsPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, locale, queue, toCheck] = await Promise.all([getT(), getLocale(), withdrawalQueue(), accountsToCheck()]);
  const total = queue.reduce((a, w) => a + w.amount, 0);
  return (
    <>
      <AutoRefresh seconds={30} />
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsWithdraw.title")} />
      <Note tone="info">{t("opsWithdraw.help")}</Note>
      {queue.length === 0 ? (
        <p className="text-[15px] text-ink-2">{t("opsWithdraw.none")}</p>
      ) : (
        <p className="text-[15px] font-semibold">{t("opsWithdraw.total", { n: queue.length, amount: fmtMoney(total) })}</p>
      )}
      {queue.map((w) => (
        <Card key={w.id}>
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-bold">
              <Link href={`/ops/helpers/${w.helperId}`} className="underline">
                {w.helperName}
              </Link>
              {w.auto && <span className="ml-2 rounded-full bg-fill px-2 py-0.5 text-[12px] font-medium text-ink-2">{t("earnings.auto")}</span>}
            </h2>
            <span className="text-[20px] font-bold tabular-nums">{fmtMoney(w.amount)}</span>
          </div>
          <p className="text-[13px] text-ink-2">{fmtDateTime(w.requestedAt, locale)}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-[15px]">
            {(
              [
                [t("kyc.bank"), w.bank],
                [t("opsWithdraw.account"), w.accountNumber],
                [t("payout.holder"), w.holderName],
                [t("opsWithdraw.amount"), String(w.amount)],
                [t("opsWithdraw.reference"), w.reference],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-2">{k}</dt>
                <dd className="break-all font-semibold tabular-nums">{v}</dd>
                <CopyButton text={v} label={k} />
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-2">
            <InlineAction action={decideWithdrawalAction} fields={{ id: w.id, sent: "0" }} label={t("opsWithdraw.failed")} className={`${btn.secondary} w-full`}>
              <input name="note" maxLength={300} placeholder={t("opsWithdraw.notePh")} className={field} />
            </InlineAction>
            <ConfirmSheet
              action={decideWithdrawalAction}
              fields={{ id: w.id, sent: "1" }}
              trigger={t("opsWithdraw.sent")}
              triggerClass={`${btn.primary} w-full`}
              title={t("opsWithdraw.sent")}
              body={t("opsWithdraw.sentBody", { amount: fmtMoney(w.amount), bank: w.bank, account: w.accountNumber })}
              confirmLabel={t("opsWithdraw.recordSent")}
            >
              <label className={fieldLabel}>
                {t("opsWithdraw.bankReference")}
                <input name="bankReference" required minLength={3} maxLength={120} className={field} autoComplete="off" />
              </label>
            </ConfirmSheet>
          </div>
        </Card>
      ))}

      {toCheck.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[17px] font-bold">{t("opsWithdraw.checkTitle")}</h2>
          <p className="text-[14px] text-ink-2">{t("opsWithdraw.checkHelp")}</p>
          {toCheck.map((a) => (
            <Card key={a.userId}>
              <p className="font-bold">
                <Link href={`/ops/helpers/${a.userId}`} className="underline">
                  {a.name}
                </Link>
                {a.verifiedName ? ` · ${a.verifiedName}` : ""}
              </p>
              <p className="text-[15px]">
                {a.bank} · <span className="break-all tabular-nums">{a.accountNumber}</span> · {a.holderName}
              </p>
              <InlineAction action={checkAccountAction} fields={{ userId: a.userId, accountUpdatedAt: a.updatedAt }} label={t("opsWithdraw.checkOk")} className={`${btn.secondary} w-full`}>
                <label className={fieldLabel}>
                  {t("opsWithdraw.bankHolder")}
                  <input name="bankHolderName" required maxLength={80} className={field} autoComplete="off" />
                </label>
                <label className={fieldLabel}>
                  {t("opsWithdraw.checkReference")}
                  <input name="bankReference" required minLength={3} maxLength={120} className={field} autoComplete="off" />
                </label>
                {!a.verifiedName && (
                  <label className="flex min-h-11 items-start gap-2 text-[14px]">
                    <input type="checkbox" name="identityConfirmed" className="mt-1 size-5" />
                    {t("opsWithdraw.identityConfirm")}
                  </label>
                )}
              </InlineAction>
            </Card>
          ))}
        </section>
      )}
    </>
  );
}
