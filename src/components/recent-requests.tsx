import { ShieldCheck } from "lucide-react";
import type { T } from "@/i18n";
import { fmtMoney } from "@/lib/format";
import type { PublicRequest } from "@/lib/public-snapshot";
import { CategoryIcon } from "./category-icon";

/** "5 min" · "3 h" · "2 days" — rounded, it's only a sense of activity. */
function ago(ms: number, t: T): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return t("landing.mins", { n: min });
  const h = Math.round(min / 60);
  return h < 24 ? t("landing.hours", { n: h }) : t("landing.days", { n: Math.round(h / 24) });
}

/**
 * "Recent requests" (social proof, PleaseHelp-style): category, price, status, time — no titles,
 * places or people. With nothing to show yet, it explains the held payment instead of faking it.
 */
export function RecentRequests({ items, t, now }: { items: PublicRequest[]; t: T; now: number }) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-float">
      <header className="flex flex-col gap-0.5">
        <h2 className="flex items-center gap-2 text-lead font-bold">
          <span aria-hidden className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-held opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-held" />
          </span>
          {items.length > 0 ? t("landing.liveTitle") : t("landing.liveEmptyTitle")}
        </h2>
        {items.length > 0 && <span className="pl-[18px] text-caption text-ink-2">{t("landing.liveSub")}</span>}
      </header>
      {items.length === 0 ? (
        <p className="flex items-start gap-2 text-small text-ink-2">
          <ShieldCheck aria-hidden size={18} className="mt-0.5 flex-none text-held" />
          {t("landing.liveEmptyBody")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((r, i) => (
            <li key={i} className="flex items-center gap-3 rounded-cta bg-canvas px-3 py-2.5">
              <CategoryIcon id={r.category} tile size={20} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-body font-semibold leading-snug">{t(`category.${r.category}`)}</span>
                <span className="line-clamp-2 block text-caption text-ink-2">
                  {t(`status.${r.status}`)} · {t("landing.ago", { t: ago(now - r.createdAt, t) })}
                </span>
              </span>
              <span className="flex-none text-body font-bold tabular-nums text-brand-ink">{fmtMoney(r.fee)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
