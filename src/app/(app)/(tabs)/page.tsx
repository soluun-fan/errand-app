import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardList, Compass, MapPin, RotateCcw, Search, ShieldCheck, UsersRound } from "lucide-react";
import { CategoryGroups } from "@/components/service-tile";
import { CategoryIcon } from "@/components/category-icon";
import { DealCard } from "@/components/deal-card";
import { RecentRequests } from "@/components/recent-requests";
import { SeasonalRow } from "@/components/seasonal-row";
import { Avatar, LinkRow, SeeAllArrow, SectionHeader, Wide, hero, seeAllClass, space } from "@/components/ui";
import { TERMINAL_STATUSES } from "@/lib/engine";
import { HelperCard } from "@/components/helper-card";
import { OpenBoard } from "@/components/open-board";
import { ReviewCard } from "@/components/review-card";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { listMyTasks } from "@/lib/deals/queries";
import { kindCovers } from "@/lib/covers";
import { liveCategories } from "@/lib/orgs";
import { getMode } from "@/lib/mode";
import { popularStarts, seasonalStarts } from "@/lib/content";
import { qsTitle } from "@/lib/content-rules";
import { pricingConfig } from "@/lib/pricing";
import { onlineHelperCount, openRequests, recentRequests } from "@/lib/public-snapshot";
import { helperDirectory, recentReviews } from "@/lib/helper-profile";
import { latestWork, portfolioThumbs } from "@/lib/work-photos";
import { WorkCard } from "@/components/work-photos";
import { DraftChip } from "./draft-chip";
import { TodoCard } from "@/components/todo-card";
import { NotifyHint } from "@/components/notify-hint";
import { InstallHint } from "@/components/install-hint";
import { customerTodos } from "@/lib/todo";

/**
 * Home (redesign 2026-11-16, shortened 2026-11-24): task first — greeting, "what do you need?",
 * search, quick starts, live tasks, categories with today's starting price. Money and past tasks
 * live in the Tasks tab; open requests, helpers, their work and reviews show on the website only.
 * Posting is the orange tab (phones) / the top bar button (web).
 */
export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) return null;
  if ((await getMode()) === "helper") redirect("/jobs");
  const [t, locale, all] = await Promise.all([getT(), getLocale(), listMyTasks(viewer.profile.id)]);
  const active = all.filter((x) => !TERMINAL_STATUSES.includes(x.deal.status));
  const past = all.filter((x) => TERMINAL_STATUSES.includes(x.deal.status));
  const [covers, todos] = await Promise.all([kindCovers(), customerTodos(viewer.profile.id, all.map((x) => x.deal))]);
  const everCompleted = all.some((x) => x.deal.status === "released");
  const repeat = [...new Map(all.filter((x) => x.deal.status === "released" && !x.deal.title.startsWith("[verify]")) /* test tasks never become chips */.map((x) => [x.deal.title, x.deal])).values()].slice(0, 3);

  // "from" price per category: the engine's build-up price for a usual job of that kind, today
  const [cfg, recent, online, board, helpers, reviews, popular, seasonal] = await Promise.all([
    pricingConfig(),
    recentRequests(4),
    onlineHelperCount(),
    openRequests(8, { withTitles: true, excludeCustomer: viewer.profile.id }),
    helperDirectory({ limit: 6 }).then((h) => h.filter((x) => x.id !== viewer.profile.id).slice(0, 3)),
    recentReviews(4),
    popularStarts(),
    seasonalStarts(),
  ]);
  const [work, thumbs] = await Promise.all([latestWork(8), portfolioThumbs(helpers.map((h) => h.id))]);
  const live = await liveCategories();
  const now = Date.now();
  // the only price that is ours: the minimum (the customer names the rest; docs/decisions.md 2026-11-16)

  const name = viewer.profile.name?.split(" ")[0];

  const section = (title: string, more: string | null, body: React.ReactNode, sub?: string) => (
    <section className={`flex flex-col ${space.section}`}>
      <SectionHeader
        title={title}
        sub={sub}
        more={
          more && (
            <Link href={more} className={seeAllClass}>
              {t("web.seeAll")} <SeeAllArrow />
            </Link>
          )
        }
      />
      {body}
    </section>
  );

  return (
    <Wide className={`flex flex-col ${space.page}`}>
      {/* what the app is waiting for from you, each with the page to do it — first thing on the screen */}
      <TodoCard items={todos} t={t} />
      {/* hero (PleaseHelp-style): question + search + quick starts · live tasks and recent requests beside it on the web.
          On wider screens its tint runs edge to edge (like the landing page) while its content stays on the page edge,
          so the search box lines up with every section below. */}
      <section className={`relative isolate ${hero.grid} md:py-12 md:first:-mt-6 md:before:absolute md:before:inset-y-0 md:before:left-1/2 md:before:-z-10 md:before:w-screen md:before:-translate-x-1/2 md:before:bg-brand-bg/50`}>
        <div className={hero.main}>
          <header className="flex items-center justify-between pt-2 md:hidden">
            <p className="text-[14px] text-ink-2">
              {name ? t("home.hello") : t("home.greetingAnon")}
              {name && <b className="block text-[17px] text-ink">{name}</b>}
            </p>
            <Link href="/profile" aria-label={t("home.profile")} className="press rounded-full">
              <Avatar name={viewer.profile.name || "?"} size={44} />
            </Link>
          </header>
          <p className="flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-full bg-bg px-3 py-1.5 text-[13px] font-medium shadow-card">
            <MapPin aria-hidden size={14} className="text-brand-ink" />
            {viewer.profile.area || t("home.area")}
            {online > 0 && <span className="text-ink-2">· {t("home.online", { n: online })}</span>}
          </p>
          <h1 className="text-[24px] font-bold leading-tight tracking-tight md:text-[40px] md:font-extrabold">
            <span className="hidden md:inline">{name ? `${t("home.hello")} ${name}. ` : ""}</span>
            {t("home.hero")}
          </h1>
          <form action="/post" className={hero.search}>
            <Search aria-hidden size={20} className="flex-none text-ink-2" />
            <label htmlFor="q" className="sr-only">
              {t("home.search")}
            </label>
            <input id="q" name="title" maxLength={40} placeholder={t("home.search")} className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-3" />
            <button aria-label={t("home.heroGo")} className={hero.searchGo}>
              <span className="hidden md:inline">{t("landing.searchGo")}</span>
              <ArrowRight aria-hidden size={20} className="md:hidden" />
            </button>
          </form>
          {/* quick starts: an unfinished draft, your repeats, then popular tasks */}
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:flex-wrap md:px-0">
            <DraftChip key={viewer.profile.id} userId={viewer.profile.id} />
            {repeat.map((d) => (
              <Link key={d.id} href={`/post?cat=${d.category}&title=${encodeURIComponent(d.title)}`} className={`${hero.chip} ${hero.chipPlain}`}>
                <RotateCcw aria-hidden size={14} />
                {d.title}
              </Link>
            ))}
            {popular.map((p) => (
              <Link key={p.id} href={`/post?cat=${p.category}&title=${encodeURIComponent(qsTitle(p, locale))}`} className={`${hero.chip} ${hero.chipPlain}`}>
                <CategoryIcon id={p.category} size={15} />
                {qsTitle(p, locale)}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {/* live tasks first: the one thing that matters right now */}
          {active.length > 0 && <h2 className="text-[15px] font-semibold">{t("tasksTab.active")}</h2>}
          {active.slice(0, 2).map((x) => (
            <DealCard key={x.deal.id} deal={x.deal} offerCount={x.offerCount} t={t} locale={locale} />
          ))}
          {active.length > 2 && <Link href="/tasks" className="flex min-h-12 items-center justify-between gap-2 text-[14px] font-semibold text-brand-ink">
            {t("home.viewActive", { n: active.length })}<ArrowRight aria-hidden size={18} className="shrink-0" />
          </Link>}
          <div className="hidden md:block"><RecentRequests items={active.length > 0 ? recent.slice(0, 2) : recent} t={t} now={now} /></div>
        </div>
      </section>
      {/* nice-to-haves after the main thing, not before it */}

      {section(
        t("home.kindsTitle"),
        null,
        // the only price that is ours is the minimum — said once (the header's sub), not on every tile
        <div className={`flex flex-col ${space.section}`}>
          <CategoryGroups live={live} cfg={cfg} covers={covers} t={t} link={(id, className, tile) => (
            <Link key={id} href={`/post?cat=${id}`} className={className}>{tile}</Link>
          )} />
        </div>,
        t("home.allFrom"),
      )}

      <nav aria-label={t("home.explore")} className="grid gap-2 sm:grid-cols-2 md:hidden">
        <LinkRow card href="/helpers" icon={UsersRound} label={t("web.helpers")} />
        <LinkRow card href="/jobs" icon={Compass} label={t("web.findWork")} />
      </nav>
      <NotifyHint />
      <InstallHint />

      <SeasonalRow
        t={t}
        locale={locale}
        items={seasonal}
        wrap={(item, card) => (
          <Link href={`/post?cat=${item.cat}&title=${encodeURIComponent(item.title)}`} className="press block h-full">
            {card}
          </Link>
        )}
      />

      {/* discovery (open requests, helpers, their work, reviews): the website only — phones stay short (2026-11-24) */}
      <div className="hidden flex-col gap-14 md:flex">
      {board.length > 0 && section(t("web.requestsTitle"), "/requests", <OpenBoard items={board} t={t} locale={locale} hrefFor={(id) => `/jobs/${id}`} covers={covers} />)}

      {helpers.length > 0 &&
        section(
          t("web.nearbyHelpers"),
          "/helpers",
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {helpers.map((h) => (
              <li key={h.id}>
                <HelperCard h={h} t={t} photos={thumbs.get(h.id)} />
              </li>
            ))}
          </ul>,
        )}

      {/* helpers' finished work (PleaseHelp "portfolio" row): every photo agreed by that job's customer */}
      {work.length > 0 &&
        section(
          t("workPhotos.homeTitle"),
          null,
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {work.map((p) => (
              <li key={p.id}>
                <WorkCard p={p} t={t} href={`/helpers/${p.helperId}`} />
              </li>
            ))}
          </ul>,
        )}

      {reviews.length > 0 &&
        section(
          t("web.reviews"),
          null,
          <div className="flex flex-col gap-3">
            <p className="text-[14px] leading-relaxed text-ink-2">{t("web.reviewsSelection")}</p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {reviews.map((r, i) => (
                <li key={i}>
                  <ReviewCard r={r} t={t} />
                </li>
              ))}
            </ul>
          </div>,
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Link href="/safety" className="flex items-start gap-2 text-[14px] font-medium text-held">
          <ShieldCheck aria-hidden size={18} className="mt-0.5 flex-none" />
          <span>
            {t("home.trust")} <span className="underline underline-offset-2">{t("home.howItWorks")}</span>
          </span>
        </Link>
        {!everCompleted && (
          <section className="-mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0">
            {([1, 2, 3] as const).map((n) => (
              <div key={n} className="w-60 flex-none snap-start rounded-card bg-bg p-4 shadow-card">
                <p className="font-semibold">{t(`home.explainer${n}Title`)}</p>
                <p className="mt-1 text-[14px] text-ink-2">{t(`home.explainer${n}Body`)}</p>
              </div>
            ))}
          </section>
        )}
        {past.length > 0 && (
          <LinkRow card href="/tasks" icon={ClipboardList} label={t("home.past")} count={past.length} />
        )}
      </div>
    </Wide>
  );
}
