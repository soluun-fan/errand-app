import { notFound } from "next/navigation";
import { FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { allQuickStarts, loadKeywords } from "@/lib/content";
import { CATEGORIES, type CategoryId } from "@/lib/engine";
import { categorySettings } from "@/lib/orgs";
import { KeywordsForm, LiveSwitch, QuickStartForm } from "./content-forms";

/**
 * /ops/content — what the app suggests, changed without a deploy (docs/decisions.md 2026-11-16
 * "From the database"): the popular chips, the seasonal row (by month), and the words that guess
 * the kind of task from search text. Admins only; every change is in the Ops log.
 */
export default async function OpsContentPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, list, keywords, settings] = await Promise.all([getT(), allQuickStarts(), loadKeywords(), categorySettings()]);
  const kinds = ["popular", "seasonal"] as const;
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsContent.title")} />
      <Note tone="info">{t("opsContent.help")}</Note>
      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-bold">{t("opsContent.kindsTitle")}</h2>
        <p className="text-[14px] text-ink-2">{t("opsContent.kindsHelp")}</p>
        <div className="flex flex-col rounded-card bg-bg shadow-card">
          {settings.map((k) => (
            <LiveSwitch key={k.category} category={k.category} trust={k.trust} live={k.live} />
          ))}
        </div>
      </section>
      {kinds.map((kind) => (
        <section key={kind} className="flex flex-col gap-3">
          <h2 className="text-[18px] font-bold">{t(`opsContent.${kind}`)}</h2>
          <p className="text-[14px] text-ink-2">{t(`opsContent.${kind}Help`)}</p>
          {list
            .filter((q) => q.kind === kind)
            .map((q) => (
              <QuickStartForm key={q.id} q={q} kind={kind} />
            ))}
          <h3 className="pt-2 text-[15px] font-semibold">{t("opsContent.new")}</h3>
          <QuickStartForm q={null} kind={kind} />
        </section>
      ))}
      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-bold">{t("opsContent.keywords")}</h2>
        <p className="text-[14px] text-ink-2">{t("opsContent.keywordsHelp")}</p>
        {CATEGORIES.filter((c): c is typeof c & { id: Exclude<CategoryId, "other"> } => c.id !== "other").map((c) => (
          <KeywordsForm key={c.id} category={c.id} words={keywords[c.id] ?? []} />
        ))}
      </section>
    </>
  );
}
