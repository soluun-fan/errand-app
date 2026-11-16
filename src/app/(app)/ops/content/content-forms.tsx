"use client";

import { useActionState } from "react";
import { SubmitButton, type ActionResult } from "@/components/sheet";
import { btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { QuickStart } from "@/lib/content-rules";
import { CATEGORIES, DEFAULT_CONFIG, type CategoryId } from "@/lib/engine";
import { deleteQuickStartAction, saveKeywordsAction, saveQuickStartAction } from "../actions";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function Result({ state }: { state: ActionResult }) {
  const t = useT();
  if (state.error)
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  return state.done ? <p className="text-sm text-held">{t("opsContent.saved")}</p> : null;
}

/** One quick start (or a new one when `q` is null): titles in both languages, kind, months, order, on/off. */
export function QuickStartForm({ q, kind }: { q: QuickStart | null; kind: QuickStart["kind"] }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(saveQuickStartAction, {});
  const [delState, del] = useActionState<ActionResult, FormData>(deleteQuickStartAction, {});
  const months = q?.months ?? MONTHS;
  return (
    <div className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={q?.id ?? ""} />
        <input type="hidden" name="kind" value={kind} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={fieldLabel}>
            {t("opsContent.titleMn")}
            <input name="titleMn" defaultValue={q?.titleMn ?? ""} maxLength={DEFAULT_CONFIG.titleMax} required className={field} />
          </label>
          <label className={fieldLabel}>
            {t("opsContent.titleEn")}
            <input name="titleEn" defaultValue={q?.titleEn ?? ""} maxLength={DEFAULT_CONFIG.titleMax} required className={field} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            {t("opsContent.category")}
            <select name="category" defaultValue={q?.category ?? "shop"} className={field}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(`categoryShort.${c.id}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            {t("opsContent.sort")}
            <input name="sort" inputMode="numeric" defaultValue={q?.sort ?? 100} className={field} />
          </label>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[14px] font-semibold">{t("opsContent.months")}</legend>
          <div className="grid grid-cols-6 gap-1.5">
            {MONTHS.map((m) => (
              <label key={m} className="flex min-h-10 items-center justify-center gap-1 rounded-input border border-line text-[14px] has-[:checked]:border-brand has-[:checked]:bg-brand-bg">
                <input type="checkbox" name={`m${m}`} defaultChecked={months.includes(m)} className="accent-brand" />
                {m}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-11 items-center gap-2 text-[15px]">
          <input type="checkbox" name="active" defaultChecked={q?.active ?? true} className="h-5 w-5 accent-brand" />
          {t("opsContent.active")}
        </label>
        <Result state={state} />
        <SubmitButton className={`${btn.primary} w-full`}>{q ? t("opsContent.save") : t("opsContent.add")}</SubmitButton>
      </form>
      {q && (
        <form action={del} className="flex flex-col gap-1">
          <input type="hidden" name="id" value={q.id} />
          <Result state={delState} />
          <SubmitButton className={`${btn.text} w-full text-danger`}>{t("opsContent.delete")}</SubmitButton>
        </form>
      )}
    </div>
  );
}

/** One kind of task's search words, one per line. */
export function KeywordsForm({ category, words }: { category: Exclude<CategoryId, "other">; words: readonly string[] }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(saveKeywordsAction, {});
  return (
    <form action={action} className="flex flex-col gap-2 rounded-card bg-bg p-4 shadow-card">
      <input type="hidden" name="category" value={category} />
      <label className={fieldLabel}>
        {t(`categoryShort.${category}`)} · {words.length}
        <textarea name="words" rows={6} defaultValue={words.join("\n")} className={`${field} min-h-36 py-2 font-mono text-[14px] leading-relaxed`} />
      </label>
      <Result state={state} />
      <SubmitButton className={`${btn.secondary} w-full`}>{t("opsContent.save")}</SubmitButton>
    </form>
  );
}
