import type { ReactNode } from "react";
import type { Locale, T } from "@/i18n";
import { qsTitle, type QuickStart } from "@/lib/content-rules";
import type { CategoryId } from "@/lib/engine";
import { CategoryIcon } from "./category-icon";

/**
 * A horizontal row of seasonal quick starts (from the `quick_starts` table, Ops edits them at
 * /ops/content). `wrap` decides what a card does (a link in the app, a login sheet on the landing
 * page) — this only lays them out. Nothing in season → nothing shown.
 */
export function SeasonalRow({
  t,
  locale,
  items,
  wrap,
}: {
  t: T;
  locale: Locale;
  items: readonly QuickStart[];
  wrap: (item: { cat: CategoryId; title: string }, card: ReactNode) => ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      {/* same heading as the other Home sections */}
      <h2 className="text-title font-bold tracking-tight md:text-headline">{t("home.seasonNow")}</h2>
      {/* phones: a swipe row lined up with the page edge (20 px); wider: one even row that fills the width */}
      <div className="-mx-5 flex snap-x scroll-px-5 gap-2.5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] sm:overflow-visible sm:px-0 md:gap-3">
        {items.map((item) => {
          const title = qsTitle(item, locale);
          return (
            <div key={item.id} className="w-40 flex-none snap-start sm:w-auto">
              {wrap(
                { cat: item.category, title },
                <span className="flex h-full flex-col gap-2 rounded-tile bg-bg p-3 text-left shadow-card">
                  <CategoryIcon id={item.category} tile size={18} />
                  <span className="text-small font-semibold leading-snug">{title}</span>
                </span>,
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
