import { CalendarClock, MapPin } from "lucide-react";
import Link from "next/link";
import type { Locale, T } from "@/i18n";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import type { PublicOpenRequest } from "@/lib/public-snapshot";
import { CategoryIcon } from "./category-icon";
import { LoginGate } from "./login-prompt";

const CARD = "press flex h-full w-full flex-col gap-2.5 rounded-card bg-bg p-4 text-left shadow-card";

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
export function OpenBoard({ items, t, locale, hrefFor }: { items: PublicOpenRequest[]; t: T; locale: Locale; hrefFor?: (id: string) => string }) {
  const tag = "inline-flex min-h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold";
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((r) => (
        <li key={r.id} className="min-w-0">
          <Opener id={r.id} hrefFor={hrefFor}>
            <span className="flex flex-wrap gap-1.5">
              <span className={`${tag} bg-fill text-ink-2`}>
                <CategoryIcon id={r.category} size={13} />
                {t(`categoryShort.${r.category}`)}
              </span>
              {r.people === 2 && <span className={`${tag} bg-route/10 text-route`}>{t("landing.twoPeople")}</span>}
              <span className={`${tag} bg-brand-bg text-brand-ink`}>{t("job.available")}</span>
            </span>
            <span className="line-clamp-2 text-[16px] font-bold leading-snug">{r.title ?? t(`landing.ask.${r.category}`)}</span>
            <span className="flex flex-col gap-1 text-[13px] text-ink-2">
              <span className="flex items-center gap-1.5">
                <MapPin aria-hidden size={14} className="flex-none text-brand-ink" />
                {r.km > 0 ? t("job.trip", { km: r.km.toFixed(1) }) : t("landing.onePlace")}
                {r.buysItems ? ` · ${t("landing.buys")}` : ""}
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarClock aria-hidden size={14} className="flex-none" />
                {r.startsAt ? fmtDateTime(r.startsAt, locale) : t("task.whenNow")} ·{" "}
                {r.minutes >= 60 ? t("price.hours", { n: r.minutes / 60 }) : t("price.min", { n: r.minutes })}
              </span>
            </span>
            <span className="mt-auto flex items-baseline justify-between border-t border-line pt-2.5">
              <span className="text-[13px] font-medium text-ink-2">{t("landing.helperGets")}</span>
              <span className="text-[20px] font-extrabold tabular-nums text-brand-ink">{fmtMoney(r.pay)}</span>
            </span>
          </Opener>
        </li>
      ))}
    </ul>
  );
}
