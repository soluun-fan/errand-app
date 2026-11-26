import {
  BadgeCheck,
  ChevronRight,
  ClipboardList,
  Hand,
  Images,
  MessageSquareQuote,
  PenLine,
  ShieldCheck,
  Siren,
  Star,
  Tag,
} from "lucide-react";
import { APP_MARK, APP_NAME } from "@/lib/brand";
import { kindCovers } from "@/lib/covers";
import { latestWork } from "@/lib/work-photos";
import { WorkCard } from "@/components/work-photos";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CategoryIcon } from "@/components/category-icon";
import { CategoryGroups } from "@/components/service-tile";
import { LandingSearch, LoginGate, LoginPromptProvider } from "@/components/login-prompt";
import { OpenBoard } from "@/components/open-board";
import { RecentRequests } from "@/components/recent-requests";
import { SeasonalRow } from "@/components/seasonal-row";
import { SectionPlaceholder, SeeAllArrow, SectionHeader, btn, hero, seeAllClass, space } from "@/components/ui";
import { ReviewCard } from "@/components/review-card";
import { recentReviews } from "@/lib/helper-profile";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { liveCategories } from "@/lib/orgs";
import { lowestMinFee } from "@/lib/engine";
import { fmtCount, fmtMoney } from "@/lib/format";
import { popularStarts, seasonalStarts } from "@/lib/content";
import { qsTitle } from "@/lib/content-rules";
import { pricingConfig } from "@/lib/pricing";
import { onlineHelperCount, openRequests, publicStats, recentRequests } from "@/lib/public-snapshot";
import { getSupportSettings } from "@/lib/support";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: { absolute: APP_NAME }, description: t("common.description") }; // not "Guigere · Guigere"
}

const wrap = "mx-auto w-full max-w-6xl px-5 sm:px-6"; // 20 px on phones, like the app (docs/ui.md)
/** Every landing section gets the same top and bottom padding, so neighbours are always 80 / 112 px apart (docs/ui.md). */
const sectionY = "py-10 md:py-14";

/**
 * Public landing page (docs/decisions.md 2026-11-16, layout ideas from PleaseHelp/UBCab, our own
 * look): visitors see what the app is and real recent activity; acting opens a login sheet that
 * brings them back. Signed-in people go straight to the app.
 */
export default async function Welcome({ searchParams }: PageProps<"/welcome">) {
  if (await getViewer()) redirect("/");
  const closed = (await searchParams).closed === "1";
  const [t, locale, cfg, recent, online, board, popular, seasonal, covers, work, live, stats, company, reviews] = await Promise.all([
    getT(),
    getLocale(),
    pricingConfig(),
    recentRequests(5),
    onlineHelperCount(),
    openRequests(8),
    popularStarts(),
    seasonalStarts(),
    kindCovers(),
    latestWork(8),
    liveCategories(),
    publicStats(),
    // the footer's company lines are a nice-to-have: the landing page never fails over them
    getSupportSettings().catch(() => null),
    recentReviews(4),
  ]);
  const now = Date.now();
  // the only price that is ours is the minimum; customers name their own

  const steps = [
    { icon: PenLine, title: t("landing.s1t"), body: t("landing.s1b") },
    { icon: Hand, title: t("landing.s2t"), body: t("landing.s2b") },
    { icon: ShieldCheck, title: t("landing.s3t"), body: t("landing.s3b") },
    { icon: Star, title: t("landing.s4t"), body: t("landing.s4b") },
  ];
  /** The numbers band: label → value, only the numbers that passed their floor. */
  const statItems: [string, ReactNode][] = [];
  if (stats?.done != null) statItems.push([t("landing.stats.done"), fmtCount(stats.done)]);
  if (stats?.helpers != null) statItems.push([t("landing.stats.helpers"), fmtCount(stats.helpers)]);
  if (stats?.reviews) {
    statItems.push([
      t("landing.stats.rating"),
      <span key="r" className="inline-flex items-center gap-1.5">
        <Star aria-hidden className="size-[0.8em] fill-brand text-brand" />
        {stats.reviews.avg.toFixed(1)}
      </span>,
    ]);
    statItems.push([t("landing.stats.reviews"), fmtCount(stats.reviews.count)]);
  }
  const why = [
    { icon: ShieldCheck, title: t("landing.w1t"), body: t("landing.w1b") },
    { icon: BadgeCheck, title: t("landing.w2t"), body: t("landing.w2b") },
    { icon: Tag, title: t("landing.w3t"), body: t("landing.w3b") },
    { icon: Siren, title: t("landing.w4t"), body: t("landing.w4b") },
  ];

  return (
    <LoginPromptProvider>
      <div className="flex flex-1 flex-col">
        {closed && (
          <p role="status" className="bg-held-bg px-4 py-3 text-center text-body font-medium text-held">
            {t("landing.closed")}
          </p>
        )}
        {/* top bar */}
        <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
          <div className={`${wrap} flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 py-2`}>
            <Link href="/welcome" className="flex shrink-0 items-center gap-2 text-title-lg font-extrabold tracking-tight">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">{APP_MARK}</span>
              {APP_NAME}
            </Link>
            <nav
              aria-label={t("tabs.navigation")}
              className="order-last hidden w-full flex-wrap items-center gap-x-6 text-body text-ink-2 md:flex lg:order-none lg:w-auto"
            >
              <a href="#how" className="flex min-h-12 items-center hover:text-ink">
                {t("landing.nav.how")}
              </a>
              <a href="#helper" className="flex min-h-12 items-center hover:text-ink">
                {t("landing.nav.helper")}
              </a>
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Link href="/login" className="flex min-h-11 items-center px-3 text-body font-semibold">
                {t("landing.nav.login")}
              </Link>
              <LoginGate
                next="/post"
                className="press hidden min-h-11 items-center rounded-input bg-brand px-4 text-body font-bold text-white sm:flex"
              >
                {t("landing.nav.post")}
              </LoginGate>
            </div>
          </div>
        </header>

        {/* hero: the question, search, popular starts — and real recent activity beside it */}
        <section className="bg-brand-bg/60">
          <div className={`${wrap} ${hero.grid} ${sectionY}`}>
            <div className={hero.main}>
              <p className="flex w-fit max-w-full items-center gap-2 rounded-full bg-bg px-3.5 py-1.5 text-meta font-medium shadow-card">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${online > 0 ? "bg-held" : "bg-ink-3"}`} />
                {online > 0 ? t("landing.areaLive", { n: online }) : t("landing.areaIdle")}
              </p>
              <h1 className="text-display font-extrabold leading-[1.1] tracking-tight text-balance md:text-hero">
                {t("landing.title1")}
                <br />
                <span className="text-brand-ink">{t("landing.title2")}</span>
              </h1>
              <p className="text-pretty text-lead leading-relaxed text-ink-2 md:text-title">{t("landing.sub")}</p>
              <LandingSearch />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-meta font-semibold text-ink-2">{t("landing.popular")}</span>
                {popular.map((p) => (
                  <LoginGate
                    key={p.id}
                    next={`/post?cat=${p.category}&title=${encodeURIComponent(qsTitle(p, locale))}`}
                    className={`${hero.chip} ${hero.chipPlain}`}
                  >
                    <CategoryIcon id={p.category} size={15} />
                    {qsTitle(p, locale)}
                  </LoginGate>
                ))}
              </div>
            </div>
            <RecentRequests items={recent} t={t} now={now} />
          </div>
        </section>

        {/* categories with today's starting price */}
        <section className={`${wrap} flex flex-col ${space.section} ${sectionY}`}>
          <SectionHeader size="lg" title={t("landing.catsTitle")} sub={t("home.allFrom")} />
          <CategoryGroups
            live={live}
            cfg={cfg}
            covers={covers}
            t={t}
            link={(id, className, tile) => (
              <LoginGate key={id} next={`/post?cat=${id}`} className={className}>
                {tile}
              </LoginGate>
            )}
          />
        </section>

        {/* what people need this season (Unegui-style row) */}
        <section className={`${wrap} pb-10 md:pb-14`}>
          <SeasonalRow
            t={t}
            locale={locale}
            items={seasonal}
            wrap={(item, card) => (
              <LoginGate next={`/post?cat=${item.cat}&title=${encodeURIComponent(item.title)}`} className="press block h-full w-full">
                {card}
              </LoginGate>
            )}
          />
        </section>

        {/* requests waiting for a helper — recruits helpers; an honest placeholder until there are some */}
        <section className={`bg-bg ${sectionY}`}>
          <div className={`${wrap} flex flex-col ${space.section}`}>
            <SectionHeader
              size="lg"
              title={t("landing.boardTitle")}
              sub={t("landing.boardSub")}
              more={
                <LoginGate next="/jobs?view=all" className={seeAllClass}>
                  {t("landing.boardAll")} <SeeAllArrow />
                </LoginGate>
              }
            />
            {board.length > 0 ? (
              <OpenBoard items={board} t={t} locale={locale} covers={covers} />
            ) : (
              <SectionPlaceholder
                icon={<ClipboardList size={22} />}
                title={t("landing.emptyBoardTitle")}
                body={t("landing.emptyBoardBody")}
                action={
                  <LoginGate next="/post" className={`${btn.primary} w-full sm:w-auto`}>
                    {t("landing.searchGo")}
                  </LoginGate>
                }
              />
            )}
          </div>
        </section>

        {/* helpers' finished work: real photos, each agreed by that job's customer */}
        <section className={`${wrap} flex flex-col ${space.section} ${sectionY}`}>
          <SectionHeader size="lg" title={t("workPhotos.homeTitle")} sub={t("workPhotos.homeSub")} />
          {work.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {work.map((p) => (
                <li key={p.id}>
                  <WorkCard p={p} t={t} href={`/helpers/${p.helperId}`} />
                </li>
              ))}
            </ul>
          ) : (
            <SectionPlaceholder icon={<Images size={22} />} title={t("landing.emptyWorkTitle")} body={t("landing.emptyWorkBody")} />
          )}
        </section>

        {/* what customers say: 4★ and up with a written note, photo reviews first (PleaseHelp-style) */}
        <section className={`${wrap} flex flex-col ${space.section} ${sectionY}`}>
          <SectionHeader size="lg" title={t("web.reviews")} sub={t("web.reviewsSelection")} />
          {reviews.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {reviews.map((r, i) => (
                <li key={i}>
                  <ReviewCard r={r} t={t} />
                </li>
              ))}
            </ul>
          ) : (
            <SectionPlaceholder
              icon={<MessageSquareQuote size={22} />}
              title={t("landing.emptyReviewsTitle")}
              body={t("landing.emptyReviewsBody")}
            />
          )}
        </section>

        {/* how it works, 4 steps */}
        <section id="how" className={`scroll-mt-20 ${sectionY}`}>
          <div className={`${wrap} flex flex-col ${space.section}`}>
            <SectionHeader size="lg" title={t("landing.howTitle")} sub={t("landing.howSub")} />
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <li key={i} className="flex flex-col gap-3 rounded-card bg-bg p-5 shadow-card">
                  <span className="text-meta font-bold text-brand-ink">{t("landing.step", { n: i + 1 })}</span>
                  <s.icon aria-hidden size={28} className="text-ink" />
                  <h3 className="text-title font-bold">{s.title}</h3>
                  <p className="text-body leading-relaxed text-ink-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* real totals, only once they're big enough (publicStats) */}
        {stats && (
          <section aria-labelledby="stats-title" className={`bg-brand-bg/60 ${sectionY}`}>
            <h2 id="stats-title" className="sr-only">
              {t("landing.stats.title")}
            </h2>
            <dl
              className={`${wrap} grid gap-x-2 gap-y-6 text-center ${statItems.length === 3 ? "grid-cols-3" : "grid-cols-2"} md:auto-cols-fr md:grid-flow-col md:grid-cols-none`}
            >
              {statItems.map(([label, value]) => (
                <div key={label} className="flex flex-col-reverse items-center justify-end gap-1">
                  <dt className="text-meta leading-snug text-balance text-ink-2 sm:text-small">{label}</dt>
                  <dd className="text-display-sm font-extrabold tabular-nums tracking-tight sm:text-display md:text-display-lg">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* why us — two-tone heading */}
        <section className={`${wrap} flex flex-col ${space.section} ${sectionY}`}>
          <h2 className="text-headline font-extrabold tracking-tight md:text-display">
            <span className="text-ink-2">{t("landing.whyA")} </span>
            {t("landing.whyB")}
          </h2>
          <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-4">
            {why.map((w, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-card bg-bg p-5 shadow-card">
                <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-bg text-brand-ink">
                  <w.icon size={22} />
                </span>
                <h3 className="text-title font-bold leading-snug">{w.title}</h3>
                <p className="text-body leading-relaxed text-ink-2">{w.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* become a helper · how prices work */}
        <section id="helper" className={`${wrap} grid scroll-mt-20 gap-3 md:grid-cols-2 ${sectionY}`}>
          <div className="flex flex-col gap-3 rounded-card bg-ink p-6 text-white md:p-8">
            <h2 className="text-headline font-extrabold">{t("landing.helperTitle")}</h2>
            <p className="text-body text-white/75">{t("landing.helperBody")}</p>
            <LoginGate
              next="/helper/apply"
              className="press mt-2 flex min-h-12 w-fit items-center rounded-input bg-brand px-5 text-lead font-bold text-white"
            >
              {t("landing.helperCta")}
            </LoginGate>
          </div>
          <div className="flex flex-col gap-3 rounded-card bg-brand-bg p-6 md:p-8">
            <h2 className="text-headline font-extrabold">{t("landing.priceTitle")}</h2>
            <p className="text-body text-ink-2">{t("landing.priceBody", { amount: fmtMoney(lowestMinFee(live, cfg)) })}</p>
          </div>
        </section>

        {/* footer (UBCab-style): what we do · help · and the trust pages as cards */}
        <footer className="mt-auto border-t border-line bg-bg pb-28 pt-10">
          <div className={`${wrap} grid gap-8 md:grid-cols-[1fr_1fr_1.2fr]`}>
            <div className="flex flex-col gap-3">
              <span className="flex items-center gap-2 text-title-lg font-extrabold tracking-tight">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-white">{APP_MARK}</span>
                {APP_NAME}
              </span>
              <p className="max-w-[40ch] text-small text-ink-2">{t("landing.footerAbout")}</p>
              {/* company details as Ops entered them (/ops/support); an empty one isn't shown */}
              {company && (company.company_name || company.company_reg_no || company.company_address || company.phone || company.email) && (
                <address className="flex flex-col gap-0.5 break-words text-meta not-italic leading-relaxed text-ink-2">
                  {(company.company_name || company.company_reg_no) && (
                    <span>
                      {[company.company_name, company.company_reg_no && t("landing.regNo", { n: company.company_reg_no })]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {company.company_address && <span>{company.company_address}</span>}
                  {(company.phone || company.email) && (
                    <span>
                      {company.phone && (
                        <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`} className="hover:text-ink">
                          {company.phone}
                        </a>
                      )}
                      {company.phone && company.email && " · "}
                      {company.email && (
                        <a href={`mailto:${company.email}`} className="hover:text-ink">
                          {company.email}
                        </a>
                      )}
                    </span>
                  )}
                </address>
              )}
              <p className="mt-1 text-meta text-ink-2">© 2026 {APP_NAME}</p>
            </div>
            <nav
              aria-label={t("landing.footerServices")}
              className="grid grid-cols-2 gap-6 text-small [&_a]:flex [&_a]:min-h-11 [&_a]:items-center [&_button]:min-h-11"
            >
              <div className="flex flex-col gap-2">
                <h3 className="font-bold">{t("landing.footerServices")}</h3>
                <LoginGate next="/post" className="text-left text-ink-2 hover:text-ink">
                  {t("landing.nav.post")}
                </LoginGate>
                <LoginGate next="/jobs?view=all" className="text-left text-ink-2 hover:text-ink">
                  {t("landing.boardAll")}
                </LoginGate>
                <a href="#helper" className="text-ink-2 hover:text-ink">
                  {t("landing.nav.helper")}
                </a>
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="font-bold">{t("landing.footerHelp")}</h3>
                <a href="#how" className="text-ink-2 hover:text-ink">
                  {t("landing.nav.how")}
                </a>
                <Link href="/login" className="text-ink-2 hover:text-ink">
                  {t("landing.nav.login")}
                </Link>
              </div>
            </nav>
            <div className="flex flex-col gap-2">
              {(
                [
                  ["/help", t("info.navHelp")],
                  ["/safety", t("info.safetyTitle")],
                  ["/privacy", t("info.privacyTitle")],
                  ["/terms", t("legal.termsTitle")],
                ] as const
              ).map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="press flex min-h-14 items-center justify-between rounded-input border border-line px-4 text-body font-semibold hover:bg-canvas"
                >
                  {label}
                  <ChevronRight aria-hidden size={18} />
                </Link>
              ))}
            </div>
          </div>
        </footer>

        {/* always-there call to action */}
        {/* the pinned call to action, on computers too (owner 2026-11-26, from the earlier landing page) */}
        <div className="fixed inset-x-0 bottom-0 z-30 bg-ink/95 pb-[env(safe-area-inset-bottom)] text-white backdrop-blur">
          <div className={`${wrap} flex min-h-16 items-center justify-between gap-3`}>
            <p className="hidden min-w-0 text-small font-medium sm:block">{t("landing.bar")}</p>
            <LoginGate next="/post" className={`${btn.primary} my-2 min-h-12 w-full px-4 text-body sm:w-auto sm:shrink-0`}>
              {t("landing.nav.post")}
            </LoginGate>
          </div>
        </div>
      </div>
    </LoginPromptProvider>
  );
}
