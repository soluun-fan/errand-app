import { FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getRules } from "@/lib/rules";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("info.privacyTitle");

/**
 * /privacy — plain-words privacy policy describing what the code actually does (docs/rules.md,
 * retention jobs in lib/tick.ts). A DRAFT until a lawyer reviews it and the owner adds company
 * and contact details (docs/decisions.md 2026-11-16).
 */
export default async function PrivacyPage() {
  const t = await getT();
  const routeDays = (await getRules().catch(() => null))?.routeRetentionDays ?? 30; // live Ops setting
  const sections = (["What", "Why", "Who", "Keep", "Rights"] as const).map((k) => ({ title: t(`info.p${k}T`), body: t(`info.p${k}B`, { routeDays }) }));
  return (
    <>
      <FlowHeader href="/" label={t("common.back")} />
      <h1 className="text-headline font-bold tracking-tight">{t("info.privacyTitle")}</h1>
      <Note tone="warn">{t("info.privacyDraft")}</Note>
      {sections.map((s) => (
        <section key={s.title} className="flex flex-col gap-1.5 rounded-card bg-bg p-4 shadow-card">
          <h2 className="text-lead font-bold">{s.title}</h2>
          <p className="text-small leading-relaxed text-ink-2">{s.body}</p>
        </section>
      ))}
    </>
  );
}
