import type { ReactNode } from "react";
import type { T } from "@/i18n";
import { CATEGORIES, kindFromLabel, type CategoryId, type EngineConfig } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";
import { CategoryIcon } from "./category-icon";
import { ExpandableGrid } from "./expandable-grid";

const tileClass = "press flex h-full min-w-0 flex-col items-start gap-3 rounded-tile bg-bg p-3 text-left shadow-card transition-shadow hover:shadow-float sm:p-4";
/** Licensed work: the same tile in one line on wider screens (3 across, one even row). */
const wideTileClass = `${tileClass} md:flex-row md:items-center md:gap-4`;

/** Rows stay full: everyday work 3 across on phones, 5 wider (10 kinds = 2 rows); licensed work one row of 3. */
const GRID = {
  open: "grid grid-cols-2 gap-2.5 min-[360px]:grid-cols-3 md:grid-cols-5 md:gap-3",
  specialized: "grid grid-cols-2 gap-2.5 min-[360px]:grid-cols-3 md:gap-3",
} as const;

/** One kind's tile content: its Ops cover photo (everyday work only) or icon, name and "from" price. */
function ServiceTile({ category, label, price, cover }: { category: CategoryId; label: string; price: string; cover?: string }) {
  return <>
    {cover ? (
      // eslint-disable-next-line @next/next/no-img-element -- public cover in Supabase Storage
      <img src={cover} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-input bg-fill object-cover" />
    ) : (
      <CategoryIcon id={category} tile size={24} />
    )}
    <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug [overflow-wrap:anywhere]">{label}</span>
    <span className="text-[13px] leading-snug tabular-nums text-ink-2">{price}</span>
  </>;
}

/**
 * The kinds of work in two groups — everyday, then licensed — the same on the public landing page
 * and the signed-in Home. `link` wraps each tile (a plain link, or the landing page's login gate).
 */
export function CategoryGroups({ live, cfg, covers, t, link }: {
  live: readonly CategoryId[];
  cfg: EngineConfig;
  covers: ReadonlyMap<CategoryId, string>;
  t: T;
  link: (id: CategoryId, className: string, tile: ReactNode) => ReactNode;
}) {
  const price = (id: CategoryId) => {
    const f = kindFromLabel(id, cfg);
    return t(f.hourly ? "home.fromHourly" : "home.from", { amount: fmtMoney(f.amount) });
  };
  return (["open", "specialized"] as const).map((group) => {
    const ids = CATEGORIES.filter((c) => live.includes(c.id) && (group === "open") === (c.trust === "open")).map((c) => c.id);
    if (!ids.length) return null;
    const wide = group === "specialized";
    return (
      <nav key={group} aria-label={t(`home.kinds.${group}`)} className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-ink-2">{t(`home.kinds.${group}`)}</h3>
        <ExpandableGrid className={GRID[group]} more={t("home.moreKinds", { n: ids.length - 6 })} less={t("home.fewerKinds")}>
          {ids.map((id) => link(id, wide ? wideTileClass : tileClass,
            <ServiceTile category={id} label={t(`categoryShort.${id}`)} price={price(id)} cover={wide ? undefined : covers.get(id)} />))}
        </ExpandableGrid>
      </nav>
    );
  });
}
