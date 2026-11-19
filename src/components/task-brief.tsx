"use client";

import { ListChecks } from "lucide-react";
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
      <label className="flex flex-col gap-2 text-[18px] font-bold">
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
        <label htmlFor="task-brief" className="text-[18px] font-bold">{t(`brief.questions.${category}`)}</label>
        <p id="brief-help" className="mt-1 text-[14px] leading-relaxed text-ink-2">{t("brief.help")}</p>
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
          className="block min-h-36 w-full resize-none overflow-hidden bg-transparent p-4 text-[17px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
        />
        <div className="flex items-start gap-2 border-t border-line bg-fill/40 px-4 py-3">
          <ListChecks aria-hidden size={17} className="mt-0.5 flex-none text-brand-ink" />
          <p id="brief-guidance" className="flex-1 text-[13px] leading-relaxed text-ink-2">{t(`brief.guidance.${category}`)}</p>
          {value.length > maxLength * 0.8 && <span className="text-xs tabular-nums text-ink-2">{value.length}/{maxLength}</span>}
        </div>
      </div>
    </section>
  );
}
