import type { JobVariety } from "@/lib/engine/job-varieties";
import type { T } from "@/i18n";
import { CONDITION_FLAGS, type ConditionFlag, type HelperBadges, type TaskConditions } from "@/lib/engine";

/**
 * Task conditions and helper badges (docs/decisions.md 2026-11-18 "Task conditions"). Shared by the
 * customer's task, the helper's job, the feed cards and the applicant cards.
 */
const ICON: Record<ConditionFlag, string> = {
  insulatedBag: "•",
  askSubstitutions: "•",
  protectSurfaces: "•",
  updates: "•",
  fragranceFree: "•",
  references: "•",
  followRoutine: "•",
  priorExperience: "✦",
  elderCareExperience: "✦",
  childCareExperience: "✦",
  driver: "🚗",
  car: "🚙",
  checked: "🛡️",
  onTime: "⏰",
  call: "📞",
  handoverCode: "🔢",
};

/** The task's conditions; with `missing`, the ones this helper doesn't meet are marked. */
export function ConditionChips({ require = {}, variety, t, missing = [] }: { variety?: JobVariety; require: TaskConditions | undefined; t: T; missing?: readonly (keyof TaskConditions)[] }) {
  const keys = CONDITION_FLAGS.filter((k) => require[k]);
  if (!variety && !keys.length && !require.language && !require.custom?.length) return null;
  const chip = (k: keyof TaskConditions, label: string) => (
    <span key={k} className={`inline-flex min-h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold ${missing.includes(k) ? "bg-warn-bg text-warn" : "bg-fill text-ink-2"}`}>
      {label}
      {missing.includes(k) && " ✕"}
    </span>
  );
  return (
    <span className="flex flex-wrap gap-1.5" aria-label={t("conditions.title")}>
      {variety && <span className="rounded-[8px] bg-brand-bg px-2 py-1 text-xs font-semibold text-brand-ink">{t(`varieties.${variety}`)}</span>}
      {keys.map((k) => chip(k, `${ICON[k]} ${t(`conditions.k.${k}`)}`))}
      {require.custom?.map((label) => <span key={`custom:${label}`} className="max-w-full rounded-[8px] bg-fill px-2 py-1 text-xs font-semibold text-ink-2 [overflow-wrap:anywhere]">{label}</span>)}
      {require.language && chip("language", `🌐 ${t(`conditions.lang.${require.language}`)}`)}
    </span>
  );
}

/** What a helper has (on an applicant card): checked licence / car, background check, on time, languages. */
export function BadgeChips({ badges, t }: { badges: HelperBadges & { record: { jobs: number; onTime: number } }; t: T }) {
  const items: string[] = [];
  if (badges.driver) items.push(`🚗 ${t("conditions.b.driver")}`);
  if (badges.car) items.push(`🚙 ${t("conditions.b.car")}`);
  if (badges.checked) items.push(`🛡️ ${t("conditions.b.checked")}`);
  if (badges.record.jobs >= 3) items.push(`⏰ ${t("conditions.b.onTime", { pct: Math.round((badges.record.onTime / badges.record.jobs) * 100), n: badges.record.jobs })}`);
  for (const l of badges.languages) items.push(`🌐 ${t(`conditions.lang.${l}`)}`);
  if (!items.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((x) => (
        <span key={x} className="rounded-full bg-held-bg px-2 py-0.5 text-[12px] font-medium text-held">
          {x}
        </span>
      ))}
    </span>
  );
}
