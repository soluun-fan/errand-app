"use client";

import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/client";
import type { JobVariety } from "@/lib/engine/job-varieties";
import type { CategoryId } from "@/lib/engine/config";
import { POSTABLE_CONDITION_FLAGS, CONDITION_FLAGS, CUSTOM_CONDITION_LENGTH, CUSTOM_CONDITION_LIMIT, LANGUAGES, type ConditionFlag, type Language, type TaskConditions } from "@/lib/engine/types";
import { btn, chipClass, field } from "./ui";

const suggestedByCategory: Record<CategoryId, ConditionFlag[]> = {
  shop: ["askSubstitutions", "driver", "car"],
  deliver: ["handoverCode", "driver", "onTime"],
  carry: ["protectSurfaces", "car", "priorExperience"],
  queue: ["updates", "onTime", "call"],
  dayjob: ["onTime", "priorExperience", "updates"],
  repair: ["priorExperience", "protectSurfaces", "call"],
  assembly: ["protectSurfaces", "priorExperience", "call"],
  trash: ["onTime", "car", "call"],
  escort: ["onTime", "priorExperience", "call"],
  plumbing: ["priorExperience", "protectSurfaces", "updates"],
  electrical: ["priorExperience", "call", "updates"],
  cleaning: ["fragranceFree", "protectSurfaces", "references"],
  childcare: ["childCareExperience", "references", "call"],
  eldercare: ["elderCareExperience", "references", "call"],
  other: ["priorExperience", "call", "updates"],
};

const suggestedByVariety: Partial<Record<JobVariety, ConditionFlag>> = {
  groceries: "insulatedBag",
  documents: "handoverCode",
  parcel: "updates",
  eventSetup: "onTime",
  appointment: "updates",
  mealPrep: "followRoutine",
};

export function ConditionPicker({ category, variety, value, onChange, pending, setPending }: {
  category: CategoryId;
  variety?: JobVariety;
  value: TaskConditions;
  onChange: (value: TaskConditions) => void;
  pending: string;
  setPending: (text: string) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const custom = value.custom ?? [];
  const label = pending.trim().replace(/\s+/g, " ");
  const duplicate = [...custom, ...POSTABLE_CONDITION_FLAGS.map(k => t(`conditions.k.${k}`))].some(k => k.toLowerCase() === label.toLowerCase());
  const add = () => {
    if (!label || duplicate || custom.length >= CUSTOM_CONDITION_LIMIT) return;
    onChange({ ...value, custom: [...custom, label] });
    setPending("");
    setAdding(false);
  };
  const extra = variety && suggestedByVariety[variety];
  const primary = [...new Set([...(extra ? [extra] : []), ...suggestedByCategory[category]])];
  const available = POSTABLE_CONDITION_FLAGS.filter(k => {
    if (k === "childCareExperience") return category === "childcare";
    if (k === "elderCareExperience") return category === "eldercare";
    if (k === "followRoutine") return category === "childcare" || category === "eldercare";
    return true;
  });
  const choices = (flags: readonly ConditionFlag[]) => flags.map(k => (
    <button key={k} type="button" aria-pressed={!!value[k]} title={t(`conditions.sub.${k}`)} className={chipClass(!!value[k])}
      onClick={() => onChange({ ...value, [k]: !value[k] || undefined })}>
      {value[k] ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
      {t(`conditions.k.${k}`)}
    </button>
  ));
  return (
    <fieldset className="min-w-0 space-y-3 rounded-card bg-bg p-4 shadow-card" aria-label={t("conditions.postTitle")}>
      <h2 className="font-semibold">{t("conditions.postTitle")}</h2>
      <p className="text-sm text-ink-2">{t("conditions.pickHelp")}</p>
      <div className="flex flex-wrap gap-2">
        {choices([...primary, ...CONDITION_FLAGS.filter(k => k !== "checked" && !expanded && !primary.includes(k) && value[k]), ...(value.checked ? ["checked" as const] : [])])}
        {custom.map(item => (
          <button key={item} type="button" aria-label={t("conditions.remove", { label: item })}
            className={`${chipClass(true)} max-w-full`} onClick={() => onChange({ ...value, custom: custom.filter(c => c !== item) })}>
            <span className="whitespace-normal text-left [overflow-wrap:anywhere]">{item}</span><X size={14} aria-hidden />
          </button>
        ))}
      </div>
      <details className="group" onToggle={e => setExpanded(e.currentTarget.open)}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-brand-ink">
          {t("conditions.more")}{value.language && ` · ${t(`conditions.lang.${value.language}`)}`}<ChevronDown size={14} aria-hidden className="group-open:rotate-180" />
        </summary>
        <div className="flex flex-wrap gap-2">{choices(available.filter(k => !primary.includes(k)))}</div>
        <label className="mt-3 block text-sm">{t("conditions.k.language")}
          <select className={`${field} mt-1`} value={value.language ?? ""} onChange={e => onChange({ ...value, language: e.target.value as Language || null })}>
            <option value="">{t("conditions.anyLanguage")}</option>
            {LANGUAGES.map(l => <option key={l} value={l}>{t(`conditions.lang.${l}`)}</option>)}
          </select>
        </label>
      </details>
      {adding ? <div>
        <label className="block text-sm font-medium">{t("conditions.newLabel")}
          <input autoFocus value={pending} maxLength={CUSTOM_CONDITION_LENGTH} placeholder={t("conditions.example")} className={`${field} mt-1`}
            onChange={e => setPending(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }} />
        </label>
        {duplicate && <p role="status" className="mt-1 text-sm text-ink-2">{t("conditions.duplicate")}</p>}
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={!label || duplicate} className={btn.secondary} onClick={add}>{t("conditions.add")}</button>
          <button type="button" className={btn.text} onClick={() => { setPending(""); setAdding(false); }}>{t("common.cancel")}</button>
        </div>
      </div> : custom.length < CUSTOM_CONDITION_LIMIT && <button type="button" onClick={() => setAdding(true)} className="flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-ink"><Plus size={16} />{t("conditions.newLabel")}</button>}
    </fieldset>
  );
}
