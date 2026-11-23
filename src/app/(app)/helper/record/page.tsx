import { redirect } from "next/navigation";
import { ConfirmSheet } from "@/components/sheet";
import { Card, FlowHeader, Note, btn, field, fieldLabel } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { getRules } from "@/lib/rules";
import { helperRecord } from "@/lib/standards";
import { recordLevel } from "@/lib/standards-rules";
import { appealMarkAction } from "./actions";

/**
 * /helper/record — the helper's own record (helper standards, 2026-11-22): late jobs in the window,
 * what they mean, and a way to explain each one to Ops. Clear rules, seen by the person they apply to.
 */
export default async function HelperRecordPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [t, locale, record, rules] = await Promise.all([getT(), getLocale(), helperRecord(viewer.profile.id), getRules()]);
  const level = recordLevel(record.active, rules);
  return (
    <>
      <FlowHeader href="/profile" label={t("common.back")} title={t("standards.recordTitle")} />
      <Card>
        <p className="text-[17px] font-bold">{t(`standards.level.${level}`)}</p>
        <p className="text-[15px] text-ink-2">{t("standards.recordCount", { n: record.active, days: record.windowDays })}</p>
        {record.pausedUntil && <Note tone="bad">{t("standards.pausedUntil", { until: fmtDateTime(record.pausedUntil, locale) })}</Note>}
      </Card>
      <Note tone="info">{t("standards.recordRules", { lower: rules.marksRankLower, pause: rules.marksPause, days: rules.marksPauseDays, review: rules.marksReview })}</Note>
      {record.marks.length === 0 && <p className="text-[15px] text-ink-2">{t("standards.recordNone")}</p>}
      {record.marks.map((m) => (
        <Card key={m.id}>
          <p className="text-[12px] font-semibold uppercase text-ink-2">
            {t(`opsMarks.kind.${m.kind}`)} · {fmtDateTime(m.at, locale)}{m.voided ? ` · ${t("standards.markRemoved")}` : ""}
          </p>
          <p className="text-[15px] font-semibold">{m.title}</p>
          {m.appealNote ? (
            <p className="text-[14px] text-ink-2">{t("standards.appealSent")}: {m.appealNote}</p>
          ) : !m.voided ? (
            <ConfirmSheet
              action={appealMarkAction}
              fields={{ markId: m.id }}
              trigger={t("standards.appeal")}
              triggerClass={btn.text}
              title={t("standards.appealTitle")}
              body={t("standards.appealBody")}
              confirmLabel={t("standards.appealSend")}
            >
              <label className={fieldLabel}>
                {t("standards.appealNote")}
                <textarea name="note" required minLength={10} maxLength={500} rows={4} className={field} />
              </label>
            </ConfirmSheet>
          ) : null}
        </Card>
      ))}
    </>
  );
}
