import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmSheet } from "@/components/sheet";
import { Card, FlowHeader, Note, btn, field } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { openUnpaidReports } from "@/lib/direct-pay";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { activeProvider } from "@/lib/payments/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUnpaidAction } from "../actions";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("opsPay.title");

/**
 * /ops/payments — what needs a person (docs/decisions.md 2026-11-18 "Direct pay + wire.mn"): helpers
 * who say they weren't paid, and refunds wire couldn't finish on its own. Admins only.
 */
export default async function OpsPaymentsPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const db = createAdminClient();
  const unpaid = await openUnpaidReports();
  const titles = unpaid.length
    ? new Map(
        (
          (
            await db
              .from("deals")
              .select("id, title")
              .in(
                "id",
                unpaid.map((u) => u.dealId),
              )
          ).data ?? []
        ).map((d) => [d.id as string, d.title as string]),
      )
    : new Map<string, string>();
  const { data: refunds } = await db
    .from("provider_refunds")
    .select("id, deal_id, amount, status, error, attempts, created_at")
    .or("status.eq.manual_required,and(status.eq.failed,attempts.gte.3)")
    .order("created_at")
    .limit(100)
    .returns<
      { id: string; deal_id: string; amount: number; status: string; error: string | null; attempts: number; created_at: string }[]
    >();

  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsPay.title")} />
      <Note tone="info">
        {activeProvider() === "wire" ? t("opsPay.wireOn") : activeProvider() === "mock" ? t("opsPay.mockOn") : t("pay.unavailable")}
      </Note>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("opsPay.unpaidTitle", { n: unpaid.length })}</h2>
        {unpaid.length === 0 && <p className="text-body text-ink-2">{t("opsPay.none")}</p>}
        {unpaid.map((u) => (
          <Card key={u.dealId}>
            <Link href={`/tasks/${u.dealId}`} className="font-semibold underline">
              {titles.get(u.dealId) ?? u.dealId}
            </Link>
            <p className="text-small text-ink-2">
              {t("opsPay.unpaidLine", { amount: fmtMoney(u.amount), when: fmtDateTime(u.reportedAt, locale) })}
            </p>
            <ConfirmSheet
              action={resolveUnpaidAction}
              fields={{ dealId: u.dealId }}
              trigger={t("opsPay.resolve")}
              triggerClass={btn.small}
              title={t("opsPay.resolveTitle")}
              body={t("opsPay.resolveBody")}
              confirmLabel={t("opsPay.resolve")}
            >
              <textarea name="note" required minLength={3} maxLength={500} className={field} placeholder={t("opsPay.notePh")} />
            </ConfirmSheet>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("opsPay.refundsTitle", { n: refunds?.length ?? 0 })}</h2>
        <p className="text-small text-ink-2">{t("opsPay.refundsHelp")}</p>
        {(refunds ?? []).map((r) => (
          <Card key={r.id}>
            <Link href={`/tasks/${r.deal_id}`} className="font-semibold underline">
              {fmtMoney(Number(r.amount))} · {r.status}
            </Link>
            <p className="text-small text-ink-2">
              {t("opsPay.refundLine", { when: fmtDateTime(Date.parse(r.created_at), locale), attempts: r.attempts })}
            </p>
            {r.error && <p className="break-words text-caption text-danger">{r.error}</p>}
          </Card>
        ))}
      </section>
    </>
  );
}
