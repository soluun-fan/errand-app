import Link from "next/link";
import { kindCovers } from "@/lib/covers";
import { CategoryIcon } from "@/components/category-icon";
import { OpenBoard } from "@/components/open-board";
import { EmptyState, FlowHeader, Wide, btn, chipClass } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { LAUNCH_CATEGORIES, type CategoryId } from "@/lib/engine";
import { openRequests } from "@/lib/public-snapshot";
import { Search } from "lucide-react";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("web.requestsTitle");

/**
 * /requests — browse every open request (Unegui-style listing): category chips, newest / best paid.
 * Helpers open one to take it or name a price; customers see what people ask and post their own.
 */
export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const sp = await searchParams;
  const cat = LAUNCH_CATEGORIES.find((c) => c.id === sp.cat)?.id as CategoryId | undefined;
  const sort = sp.sort === "pay" ? "pay" : "new";
  const [t, locale, items] = await Promise.all([getT(), getLocale(), openRequests(60, { category: cat, sort, withTitles: true, excludeCustomer: viewer.profile.id })]);
  const href = (p: { cat?: string; sort?: string }) => {
    const q = new URLSearchParams();
    const c = "cat" in p ? p.cat : cat;
    const s = "sort" in p ? p.sort : sort;
    if (c) q.set("cat", c);
    if (s && s !== "new") q.set("sort", s);
    const qs = q.toString();
    return `/requests${qs ? `?${qs}` : ""}`;
  };
  return (
    <Wide className="flex flex-col gap-5 pb-10">
      <div className="md:hidden">
        <FlowHeader href="/" label={t("common.back")} />
      </div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline font-bold tracking-tight md:text-display">{t("web.requestsTitle")}</h1>
          <p className="mt-1 text-body text-ink-2">{t("web.requestsSub")}</p>
        </div>
        <Link href={cat ? `/post?cat=${cat}` : "/post"} className={`${btn.primary} min-h-12 text-lead`}>
          {t("web.yourTask")}
        </Link>
      </header>
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
        <Link href={href({ sort: "new" })} className={chipClass(sort === "new")}>
          {t("web.sortNew")}
        </Link>
        <Link href={href({ sort: "pay" })} className={chipClass(sort === "pay")}>
          {t("web.sortPay")}
        </Link>
      </nav>
      {items.length === 0 ? (
        <EmptyState icon={<Search aria-hidden size={28} />} title={t("web.noRequests")} />
      ) : (
        <OpenBoard items={items} t={t} locale={locale} hrefFor={(id) => `/jobs/${id}`} covers={await kindCovers()} />
      )}
    </Wide>
  );
}
