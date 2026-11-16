import type { ReactNode } from "react";
import type { T } from "@/i18n";
import { SEASONAL, seasonAt, type SeasonKey } from "@/lib/popular";
import type { CategoryId } from "@/lib/engine";
import { CategoryIcon } from "./category-icon";

/**
 * A horizontal row of seasonal quick starts. `wrap` decides what a card does (a link in the app,
 * a login sheet on the landing page) — this only lays them out.
 */
export function SeasonalRow({ t, now, wrap }: { t: T; now: number; wrap: (item: { cat: CategoryId; key: SeasonKey; title: string }, card: ReactNode) => ReactNode }) {
  const season = seasonAt(now);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[17px] font-bold">{t(`home.season.${season}`)}</h2>
      <div className="-mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1">
        {SEASONAL[season].map((item) => {
          const title = t(`home.sea.${item.key}`);
          return (
            <div key={item.key} className="w-40 flex-none snap-start">
              {wrap(
                { ...item, title },
                <span className="flex h-full flex-col gap-2 rounded-tile bg-bg p-3 text-left shadow-card">
                  <CategoryIcon id={item.cat} tile size={18} />
                  <span className="text-[14px] font-semibold leading-snug">{title}</span>
                </span>,
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
