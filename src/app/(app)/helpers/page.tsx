import { Heart } from "lucide-react";
import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import { HelperCard } from "@/components/helper-card";
import { EmptyState, FlowHeader, Wide, chipClass } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { LAUNCH_CATEGORIES, type CategoryId } from "@/lib/engine";
import { helperDirectory, savedHelperIds, type HelperSort } from "@/lib/helper-profile";
import { portfolioThumbs } from "@/lib/work-photos";

/**
 * /helpers — browse verified helpers (PleaseHelp "내 주변 헬퍼" / Unegui-style listing): category,
 * sort by rating / jobs / newest, or only your ♥ saved ones. Each card opens the public profile.
 */
export default async function HelpersPage({ searchParams }: PageProps<"/helpers">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const sp = await searchParams;
  const cat = LAUNCH_CATEGORIES.find((c) => c.id === sp.cat)?.id as CategoryId | undefined;
  const sort: HelperSort = sp.sort === "jobs" ? "jobs" : sp.sort === "new" ? "new" : "rating";
  const onlySaved = sp.saved === "1";
  const [t, saved] = await Promise.all([getT(), savedHelperIds(viewer.profile.id)]);
  const people = (await helperDirectory({ category: cat, sort, ids: onlySaved ? saved : undefined })).filter((h) => h.id !== viewer.profile.id);
  const thumbs = await portfolioThumbs(people.map((h) => h.id));
  const savedSet = new Set(saved);
  const href = (p: { cat?: string; sort?: string; saved?: boolean }) => {
    const q = new URLSearchParams();
    const c = "cat" in p ? p.cat : cat;
    const s = "sort" in p ? p.sort : sort;
    const v = "saved" in p ? p.saved : onlySaved;
    if (c) q.set("cat", c);
    if (s && s !== "rating") q.set("sort", s);
    if (v) q.set("saved", "1");
    const qs = q.toString();
    return `/helpers${qs ? `?${qs}` : ""}`;
  };
  return (
    <Wide className="flex flex-col gap-5 pb-10">
      <div className="md:hidden">
        <FlowHeader href="/" label={t("common.back")} />
      </div>
      <header>
        <h1 className="text-[24px] font-bold tracking-tight md:text-[30px]">{t("web.helpersTitle")}</h1>
        <p className="mt-1 text-[15px] text-ink-2">{t("web.helpersSub")}</p>
      </header>
      <nav className="flex gap-2">
        <Link href={href({ saved: false })} className={chipClass(!onlySaved)}>
          {t("web.all")}
        </Link>
        <Link href={href({ saved: true })} className={chipClass(onlySaved)}>
          <Heart aria-hidden size={15} /> {t("web.saved")} ({saved.length})
        </Link>
      </nav>
      <nav className="-mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0">
        <Link href={href({ cat: undefined })} className={chipClass(!cat)}>
          {t("web.all")}
        </Link>
        {LAUNCH_CATEGORIES.map((c) => (
          <Link key={c.id} href={href({ cat: c.id })} className={chipClass(cat === c.id)}>
            <CategoryIcon id={c.id} size={15} /> {t(`categoryShort.${c.id}`)}
          </Link>
        ))}
        <span className="mx-1 hidden w-px self-stretch bg-line md:block" />
        {(["rating", "jobs", "new"] as const).map((s) => (
          <Link key={s} href={href({ sort: s })} className={chipClass(sort === s)}>
            {t(s === "rating" ? "web.sortRating" : s === "jobs" ? "web.sortJobs" : "web.sortNew")}
          </Link>
        ))}
      </nav>
      {people.length === 0 ? (
        <EmptyState icon={onlySaved ? "♡" : "🔎"} title={onlySaved ? t("helperProfile.savedEmpty") : t("web.noHelpers")} body={onlySaved ? t("helperProfile.savedEmptyBody") : undefined} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((h) => (
            <li key={h.id}>
              <HelperCard h={h} t={t} saved={savedSet.has(h.id)} photos={thumbs.get(h.id)} />
            </li>
          ))}
        </ul>
      )}
    </Wide>
  );
}
