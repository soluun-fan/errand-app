import { intlLocale, type Locale } from "@/i18n";
import { UB_TZ, fmtClock } from "@/lib/format";

/**
 * A task's history, newest first, grouped by day: the day once as a small heading, then only the
 * clock time on each line (2026-11-24 UX pass: the full date on every line was noisy). The newest
 * few are shown; the rest fold under "See all".
 */
export function TimelineList<E extends { at: number }>({ events, describe, locale, moreLabel, visible = 6 }: {
  events: E[];
  describe: (e: E) => string;
  locale: Locale;
  moreLabel: string;
  visible?: number;
}) {
  const day = new Intl.DateTimeFormat(intlLocale(locale), { timeZone: UB_TZ, month: "long", day: "numeric" });
  const groups = (list: E[]) => {
    const out: { day: string; items: E[] }[] = [];
    for (const e of list) {
      const d = day.format(e.at);
      if (out.at(-1)?.day === d) out.at(-1)!.items.push(e);
      else out.push({ day: d, items: [e] });
    }
    return out;
  };
  const render = (list: E[], keyBase: number) =>
    groups(list).map((g, gi) => (
      <li key={`${keyBase}-${gi}`} className="flex flex-col gap-2">
        <p className="text-[13px] font-semibold text-ink-3">{g.day}</p>
        <ol className="flex flex-col gap-2 border-l-2 border-line pl-3">
          {g.items.map((e, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-11 flex-none text-ink-2 tabular-nums">{fmtClock(e.at)}</span>
              <span className="min-w-0">{describe(e)}</span>
            </li>
          ))}
        </ol>
      </li>
    ));
  const head = events.slice(0, visible);
  const rest = events.slice(visible);
  return (
    <div className="flex flex-col gap-3 pt-1">
      <ul className="flex flex-col gap-3">{render(head, 0)}</ul>
      {rest.length > 0 && (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center font-semibold text-brand-ink group-open:hidden">
            {moreLabel} ({rest.length})
          </summary>
          <ul className="flex flex-col gap-3">{render(rest, 1)}</ul>
        </details>
      )}
    </div>
  );
}
