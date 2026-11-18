import { notFound } from "next/navigation";
import { InlineAction } from "@/components/inline-action";
import { Card, FlowHeader, Note, btn } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { openErrors } from "@/lib/error-log";
import { fmtDateTime } from "@/lib/format";
import { resolveErrorAction } from "../actions";

/**
 * /ops/errors — what broke, grouped (docs/decisions.md 2026-11-18 "Launch readiness"). Ops gets a
 * push for each new kind; "Fixed" closes it, and it reopens (with a new alert) if it happens again.
 */
export default async function OpsErrorsPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, locale, errors] = await Promise.all([getT(), getLocale(), openErrors()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsErrors.title")} />
      <Note tone="info">{t("opsErrors.help")}</Note>
      {errors.length === 0 && <p className="text-[15px] text-ink-2">{t("opsErrors.none")}</p>}
      {errors.map((e) => (
        <Card key={e.fingerprint}>
          <p className="text-[12px] font-semibold uppercase text-ink-2">
            {t(`opsErrors.source.${e.source}`)} · {e.route}
          </p>
          <p className="break-words text-[15px] font-semibold">{e.message}</p>
          <p className="text-[13px] text-ink-2">{t("opsErrors.seen", { n: e.count, first: fmtDateTime(e.firstAt, locale), last: fmtDateTime(e.lastAt, locale) })}</p>
          {e.stack && (
            <details>
              <summary className="cursor-pointer text-[13px] font-semibold text-brand-ink">{t("opsErrors.details")}</summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-input bg-fill p-2 text-[11px]">{e.stack}</pre>
            </details>
          )}
          <InlineAction action={resolveErrorAction} fields={{ fingerprint: e.fingerprint }} label={t("opsErrors.fixed")} className={`${btn.secondary} w-full`} />
        </Card>
      ))}
    </>
  );
}
