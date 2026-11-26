import { notFound } from "next/navigation";
import Link from "next/link";
import { InlineAction } from "@/components/inline-action";
import { Card, FlowHeader, Note, btn } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { getRules } from "@/lib/rules";
import { opsMarks } from "@/lib/standards";
import { recordLevel } from "@/lib/standards-rules";
import { liftPauseAction, voidMarkAction } from "../actions";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("opsMarks.title");

/**
 * /ops/marks — helper standards (docs/decisions.md 2026-11-22). Late jobs leave a mark; marks build
 * the ladder. Appeals come first. Void a mark when the delay wasn't the helper's fault; lift a pause
 * after reviewing someone at the "Ops review" step. Both are logged.
 */
export default async function OpsMarksPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, locale, marks, rules] = await Promise.all([getT(), getLocale(), opsMarks(), getRules()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsMarks.title")} />
      <Note tone="info">{t("opsMarks.help", { days: rules.marksWindowDays, lower: rules.marksRankLower, pause: rules.marksPause, review: rules.marksReview })}</Note>
      {marks.length === 0 && <p className="text-body text-ink-2">{t("opsMarks.none")}</p>}
      {marks.map((m) => (
        <Card key={m.id}>
          <p className="text-caption font-semibold uppercase text-ink-2">
            {t(`opsMarks.kind.${m.kind}`)} · {fmtDateTime(m.at, locale)}{m.voided ? ` · ${t("opsMarks.voided")}` : ""}
          </p>
          <p className="text-body font-semibold">
            <Link href={`/ops/helpers/${m.helperId}`} className="underline">{m.helperName}</Link> — {m.title}
          </p>
          <p className="text-meta text-ink-2">
            {t("opsMarks.count", { n: m.activeForHelper })} · {t(`standards.level.${recordLevel(m.activeForHelper, rules)}`)}
            {m.pausedUntil ? ` · ${t("opsMarks.pausedUntil", { until: fmtDateTime(m.pausedUntil, locale) })}` : ""}
          </p>
          {m.appealNote && <Note tone="warn">{t("opsMarks.appeal")}: {m.appealNote}</Note>}
          <div className="flex flex-wrap gap-2">
            {!m.voided && <InlineAction action={voidMarkAction} fields={{ markId: m.id }} label={t("opsMarks.void")} className={btn.secondary} />}
            {m.pausedUntil && <InlineAction action={liftPauseAction} fields={{ helperId: m.helperId }} label={t("opsMarks.lift")} className={btn.secondary} />}
            <Link href={`/tasks/${m.dealId}`} className={btn.text}>{t("opsMarks.openTask")}</Link>
          </div>
        </Card>
      ))}
    </>
  );
}
