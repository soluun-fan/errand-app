import type { T } from "@/i18n";
import type { HelperBadges, TaskConditions } from "@/lib/engine";

/**
 * Task conditions and helper badges (docs/decisions.md 2026-11-18 "Task conditions"). Shared by the
 * customer's task, the helper's job, the feed cards and the applicant cards.
 */
const ICON: Record<Exclude<keyof TaskConditions, "language">, string> = {
  driver: "🚗",
  car: "🚙",
  checked: "🛡️",
  onTime: "⏰",
  call: "📞",
  handoverCode: "🔢",
};

/** The task's conditions; with `missing`, the ones this helper doesn't meet are marked. */
export function ConditionChips({ require, t, missing = [] }: { require: TaskConditions | undefined; t: T; missing?: readonly (keyof TaskConditions)[] }) {
  if (!require) return null;
  const keys = (Object.keys(ICON) as (keyof typeof ICON)[]).filter((k) => require[k]);
  if (!keys.length && !require.language) return null;
  const chip = (k: keyof TaskConditions, label: string) => (
    <span key={k} className={`inline-flex min-h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold ${missing.includes(k) ? "bg-warn-bg text-warn" : "bg-fill text-ink-2"}`}>
      {label}
      {missing.includes(k) && " ✕"}
    </span>
  );
  return (
    <span className="flex flex-wrap gap-1.5" aria-label={t("conditions.title")}>
      {keys.map((k) => chip(k, `${ICON[k]} ${t(`conditions.k.${k}`)}`))}
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
