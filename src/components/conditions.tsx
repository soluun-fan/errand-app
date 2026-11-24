import type { JobVariety } from "@/lib/engine/job-varieties";
import { AlarmClock, Car, Globe, Hash, IdCard, Phone, ShieldCheck, Star, type LucideIcon } from "lucide-react";
import type { T } from "@/i18n";
import { Ico } from "./icon";
import { CONDITION_FLAGS, type ConditionFlag, type HelperBadges, type TaskConditions } from "@/lib/engine";

/**
 * Task conditions and helper badges (docs/decisions.md 2026-11-18 "Task conditions"). Shared by the
 * customer's task, the helper's job, the feed cards and the applicant cards.
 */
const ICON: Partial<Record<ConditionFlag, LucideIcon>> = {
  priorExperience: Star,
  elderCareExperience: Star,
  childCareExperience: Star,
  driver: IdCard,
  car: Car,
  checked: ShieldCheck,
  onTime: AlarmClock,
  call: Phone,
  handoverCode: Hash,
};

/** The task's conditions; with `missing`, the ones this helper doesn't meet are marked. */
export function ConditionChips({ require = {}, variety, t, missing = [] }: { variety?: JobVariety; require: TaskConditions | undefined; t: T; missing?: readonly (keyof TaskConditions)[] }) {
  const keys = CONDITION_FLAGS.filter((k) => require[k]);
  if (!variety && !keys.length && !require.language && !require.custom?.length) return null;
  const chip = (k: keyof TaskConditions, label: string, icon?: LucideIcon) => (
    <span key={k} className={`inline-flex min-h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold ${missing.includes(k) ? "bg-warn-bg text-warn" : "bg-fill text-ink-2"}`}>
      {icon && <Ico as={icon} size={13} />}
      {label}
      {missing.includes(k) && " ✕"}
    </span>
  );
  return (
    <span className="flex flex-wrap gap-1.5" aria-label={t("conditions.title")}>
      {variety && <span className="rounded-[8px] bg-brand-bg px-2 py-1 text-xs font-semibold text-brand-ink">{t(`varieties.${variety}`)}</span>}
      {keys.map((k) => chip(k, t(`conditions.k.${k}`), ICON[k]))}
      {require.custom?.map((label) => <span key={`custom:${label}`} className="max-w-full rounded-[8px] bg-fill px-2 py-1 text-xs font-semibold text-ink-2 [overflow-wrap:anywhere]">{label}</span>)}
      {require.language && chip("language", t(`conditions.lang.${require.language}`), Globe)}
    </span>
  );
}

/** What a helper has (on an applicant card): checked licence / car, on-time record, languages. */
export function BadgeChips({ badges, t }: { badges: HelperBadges & { record: { jobs: number; onTime: number } }; t: T }) {
  const items: [LucideIcon, string][] = [];
  if (badges.driver) items.push([IdCard, t("conditions.b.driver")]);
  if (badges.car) items.push([Car, t("conditions.b.car")]);
  if (badges.record.jobs >= 3) items.push([AlarmClock, t("conditions.b.onTime", { pct: Math.round((badges.record.onTime / badges.record.jobs) * 100), n: badges.record.jobs })]);
  for (const l of badges.languages) items.push([Globe, t(`conditions.lang.${l}`)]);
  if (!items.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map(([icon, x]) => (
        <span key={x} className="inline-flex items-center gap-1 rounded-full bg-held-bg px-2 py-0.5 text-[12px] font-medium text-held">
          <Ico as={icon} size={13} />
          {x}
        </span>
      ))}
    </span>
  );
}
