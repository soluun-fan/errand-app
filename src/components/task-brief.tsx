"use client";

import { ListChecks, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "@/i18n/client";
import type { CategoryId } from "@/lib/engine";
import { field } from "./ui";

/** One message is enough to post. A short title is prepared for the customer and can be edited. */
export function TaskBrief({ category, value, title, titleValue, maxLength, titleMax, onChange, onTitleChange }: {
  category: CategoryId;
  value: string;
  title: string;
  titleValue: string;
  maxLength: number;
  titleMax: number;
  onChange: (value: string) => void;
  onTitleChange: (value: string) => void;
}) {
  const t = useT();
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, category]);

  return (
    <section className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-title font-bold">
        {t("post.taskTitle")}
        <input
          className={`${field} font-normal`}
          value={titleValue}
          placeholder={title || t(`categoryExample.${category}`)}
          maxLength={titleMax}
          onChange={(e) => onTitleChange(e.target.value)}
        />
      </label>
      <div>
        <label htmlFor="task-brief" className="text-title font-bold">{t(`brief.questions.${category}`)}</label>
        <p id="brief-help" className="mt-1 text-small leading-relaxed text-ink-2">{t("brief.help")}</p>
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-bg shadow-card focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
        <textarea
          ref={textarea}
          id="task-brief"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t(`brief.examples.${category}`)}
          maxLength={maxLength}
          rows={4}
          aria-describedby="brief-help brief-guidance"
          className="block min-h-36 w-full resize-none overflow-hidden bg-transparent p-4 text-title leading-relaxed text-ink outline-none placeholder:text-ink-3"
        />
        <div className="flex items-start gap-2 border-t border-line bg-fill/40 px-4 py-3">
          <ListChecks aria-hidden size={17} className="mt-0.5 flex-none text-brand-ink" />
          <p id="brief-guidance" className="flex-1 text-meta leading-relaxed text-ink-2">{t(`brief.guidance.${category}`)}</p>
          {value.length > maxLength * 0.8 && <span className="text-caption tabular-nums text-ink-2">{value.length}/{maxLength}</span>}
        </div>
      </div>
      {/* tap-to-fill (PleaseHelp-style): a usual request for this kind, so posting needs less typing */}
      <div className="flex flex-col gap-1.5">
        <span className="text-meta text-ink-2">{t("brief.startersLabel")}</span>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:flex-wrap md:px-0">
          {(["a", "b"] as const).map((k) => {
            const phrase = t(`brief.starters.${category}.${k}`);
            const used = value.includes(phrase);
            return (
              <button
                key={k}
                type="button"
                disabled={used || value.length + phrase.length + 1 > maxLength}
                onClick={() => onChange(value.trim() ? `${value.trimEnd()}\n${phrase}` : phrase)}
                className="press inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full border border-line bg-bg px-3.5 text-small font-medium disabled:opacity-50"
              >
                <Sparkles aria-hidden size={15} className="flex-none text-brand-ink" />
                {phrase}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
