import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmSheet } from "@/components/sheet";
import { Card, FlowHeader, Note, btn, field, fieldLabel } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { openDisputes } from "@/lib/disputes";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { disputeReasonLabel } from "@/lib/labels";
import { titled } from "@/lib/page-title";
import { resolveDisputeAction } from "../actions";

export const generateMetadata = titled("opsDisputes.title");

const DAY_MS = 24 * 3_600_000;

/**
 * /ops/disputes — tasks whose money is held until Ops decides (docs/screens-helper-ops.md
 * "Disputes"): oldest first, red after 24 h. Each shows the reason, the customer's note, the held
 * amount and the conversation; Ops pays the helper or refunds the customer, with a note. Admins only.
 */
export default async function OpsDisputesPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, locale, disputes] = await Promise.all([getT(), getLocale(), openDisputes()]);
  const now = Date.now();
  const note = (
    <label className={fieldLabel}>
      {t("opsDisputes.note")}
      <textarea name="note" rows={3} minLength={5} maxLength={1000} required className={field} />
    </label>
  );
  return (
    <>
      <AutoRefresh seconds={60} />
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsDisputes.title")} />
      <Note tone="info">{t("opsDisputes.help")}</Note>
      {disputes.length === 0 && <p className="text-body text-ink-2">{t("opsDisputes.none")}</p>}
      {disputes.map(({ deal, customerName, helperName, reason, note: customerNote, openedAt, messages }) => {
        const overdue = openedAt > 0 && now - openedAt > DAY_MS;
        return (
          <Card key={deal.id}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-bold">
                <Link href={`/tasks/${deal.id}`} className="underline">
                  {deal.title}
                </Link>
              </h2>
              <span className="text-title-lg font-bold tabular-nums">{fmtMoney(deal.heldAmount)}</span>
            </div>
            <p className={`text-meta ${overdue ? "font-semibold text-danger" : "text-ink-2"}`}>
              {t("opsDisputes.opened", { when: openedAt > 0 ? fmtDateTime(openedAt, locale) : "—" })}
            </p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-body">
              <dt className="text-ink-2">{t("opsDisputes.customer")}</dt>
              <dd className="font-semibold">{customerName}</dd>
              <dt className="text-ink-2">{t("opsDisputes.helper")}</dt>
              <dd className="font-semibold">{helperName}</dd>
              <dt className="text-ink-2">{t("opsDisputes.reason")}</dt>
              <dd className="font-semibold">{disputeReasonLabel(reason, t)}</dd>
            </dl>
            {customerNote && <p className="whitespace-pre-line rounded-input bg-fill p-3 text-body">{customerNote}</p>}
            <details className="text-small">
              <summary className="cursor-pointer py-2 font-semibold">{t("opsDisputes.chat", { n: messages.length })}</summary>
              {messages.length === 0 ? (
                <p className="text-ink-2">{t("opsDisputes.noChat")}</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {messages.map((m, i) => (
                    <li key={i} className={m.from === "system" ? "text-ink-2" : ""}>
                      <span className="font-semibold">
                        {m.from === "customer" ? t("opsDisputes.customer") : m.from === "helper" ? t("opsDisputes.helper") : "·"}
                      </span>{" "}
                      <span className="text-caption text-ink-2">{fmtDateTime(m.at, locale)}</span>
                      <span className="block whitespace-pre-line break-words">
                        {m.text}
                        {m.photo && ` ${t("opsDisputes.attachment")}`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </details>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ConfirmSheet
                action={resolveDisputeAction}
                fields={{ dealId: deal.id, outcome: "refund" }}
                trigger={t("opsDisputes.refund")}
                triggerClass={`${btn.secondary} w-full`}
                title={t("opsDisputes.refund")}
                body={t("opsDisputes.refundBody", { amount: fmtMoney(deal.heldAmount), name: customerName })}
                confirmLabel={t("opsDisputes.refund")}
              >
                {note}
              </ConfirmSheet>
              <ConfirmSheet
                action={resolveDisputeAction}
                fields={{ dealId: deal.id, outcome: "release" }}
                trigger={t("opsDisputes.release")}
                triggerClass={`${btn.primary} w-full`}
                title={t("opsDisputes.release")}
                body={t("opsDisputes.releaseBody", { name: helperName })}
                confirmLabel={t("opsDisputes.release")}
              >
                {note}
              </ConfirmSheet>
            </div>
          </Card>
        );
      })}
    </>
  );
}
