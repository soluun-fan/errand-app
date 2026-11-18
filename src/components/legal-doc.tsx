import { Note } from "@/components/ui";
import type { T } from "@/i18n";

/** A legal document: title, version, "draft" notice, numbered sections. */
export function LegalDoc({ t, title, version, sections }: { t: T; title: string; version: string; sections: { title: string; body: string }[] }) {
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-[24px] font-bold tracking-tight">{title}</h1>
        <p className="text-[13px] text-ink-2">{t("legal.version", { v: version })}</p>
      </header>
      <Note tone="warn">{t("legal.draft")}</Note>
      <ol className="flex flex-col gap-3">
        {sections.map((s, i) => (
          <li key={i} className="flex flex-col gap-1.5 rounded-card bg-bg p-4 shadow-card">
            <h2 className="text-[16px] font-bold">
              {i + 1}. {s.title}
            </h2>
            <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}
