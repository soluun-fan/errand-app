import { CalendarClock, MapPin, Zap } from "lucide-react";
import Link from "next/link";
import { ConditionChips } from "./conditions";
import type { Locale, T } from "@/i18n";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import type { PublicOpenRequest } from "@/lib/public-snapshot";
import { CategoryIcon } from "./category-icon";
import { LoginGate } from "./login-prompt";

const CARD = "press flex h-full w-full min-w-0 flex-col gap-3 overflow-hidden rounded-card bg-bg p-4 text-left shadow-card transition-shadow hover:shadow-float";

/** In the app a card is a link; on the public landing it opens the login sheet first. */
function Opener({ id, hrefFor, children }: { id: string; hrefFor?: (id: string) => string; children: React.ReactNode }) {
  return hrefFor ? (
    <Link href={hrefFor(id)} className={CARD}>
      {children}
    </Link>
  ) : (
    <LoginGate next={`/jobs/${id}`} className={CARD}>
      {children}
    </LoginGate>
  );
}

/**
 * Public "requests waiting for a helper" board (landing). PleaseHelp-style cards, but privacy
 * first: a standard title per category (never the customer's words), no place, no person —
 * trip length, time and pay only. Opening one asks to log in and lands on that job.
 */
export function OpenBoard({
  items,
  t,
  locale,
  hrefFor,
  covers,
}: {
  items: PublicOpenRequest[];
  t: T;
  locale: Locale;
  hrefFor?: (id: string) => string;
  /** The kind's example picture (public, generic) — never the customer's own photos on this board. */
  covers?: Map<string, string>;
}) {
  const tag = "inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-caption font-semibold";
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((r) => (
        <li key={r.id} className="min-w-0">
          <Opener id={r.id} hrefFor={hrefFor}>
            {covers?.get(r.category) && (
              // eslint-disable-next-line @next/next/no-img-element -- public cover in Supabase Storage
              <img src={covers.get(r.category)} alt="" loading="lazy" className="-mx-4 -mt-4 mb-1 aspect-[16/9] w-[calc(100%+2rem)] max-w-none rounded-t-card object-cover" />
            )}
            <span className="flex flex-wrap gap-1.5">
              <span className={`${tag} bg-fill text-ink-2`}>
                <CategoryIcon id={r.category} size={13} />
                {t(`categoryShort.${r.category}`)}
              </span>
              {r.people === 2 && <span className={`${tag} bg-route/10 text-route`}>{t("landing.twoPeople")}</span>}
              <span className={`${tag} bg-brand-bg text-brand-ink`}>{t("job.available")}</span>
            </span>
            <span className="line-clamp-3 min-h-12 break-words text-title font-bold leading-snug">{r.title ?? t(`landing.ask.${r.category}`)}</span>
            <ConditionChips variety={r.variety} require={r.require} t={t} />
            <span className="flex flex-col gap-1 text-meta text-ink-2">
              <span className="flex items-start gap-1.5">
                <MapPin aria-hidden size={14} className="flex-none text-brand-ink" />
                <span className="min-w-0">{r.km > 0 ? t("job.trip", { km: r.km.toFixed(1) }) : t("landing.onePlace")}
                {r.buysItems ? ` · ${t("landing.buys")}` : ""}</span>
              </span>
              <span className="flex items-start gap-1.5">
                {r.startsAt || r.openUntil ? <CalendarClock aria-hidden size={14} className="flex-none" /> : <Zap aria-hidden size={14} className="flex-none text-brand-ink" />}
                <span className="min-w-0">{r.startsAt ? (
                  fmtDateTime(r.startsAt, locale)
                ) : r.openUntil ? (
                  t("task.whenFlexibleUntil", { time: fmtDateTime(r.openUntil, locale) })
                ) : (
                  <b className="font-semibold text-brand-ink">{t("task.whenNow")}</b>
                )}{" "}
                ·{" "}
                {r.minutes >= 60 ? t("price.hours", { n: r.minutes / 60 }) : t("price.min", { n: r.minutes })}</span>
              </span>
            </span>
            <span className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-3">
              <span className="text-meta font-medium text-ink-2">{t("landing.helperGets")}</span>
              <span className="text-title-lg font-extrabold tabular-nums text-brand-ink">{fmtMoney(r.pay)}</span>
            </span>
          </Opener>
        </li>
      ))}
    </ul>
  );
}
