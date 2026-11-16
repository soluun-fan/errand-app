import { BadgeCheck, Hand, PenLine, ShieldCheck, Siren, Star, Tag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CategoryIcon } from "@/components/category-icon";
import { LandingSearch, LoginGate, LoginPromptProvider } from "@/components/login-prompt";
import { OpenBoard } from "@/components/open-board";
import { RecentRequests } from "@/components/recent-requests";
import { btn } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { CATEGORIES, minFeeAt } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";
import { POPULAR } from "@/lib/popular";
import { pricingConfig } from "@/lib/pricing";
import { onlineHelperCount, openRequests, recentRequests } from "@/lib/public-snapshot";

export const metadata: Metadata = {
  title: "Tuslamj — даалгаврын туслагч, банкинд хадгалагдах төлбөр",
  description: "Улаанбаатарт хүнс авчрах, хүргэх, зөөх, засвар. Нэг хүсэлт бичихэд ойрын туслагчид санал ирүүлнэ.",
};

const wrap = "mx-auto w-full max-w-6xl px-4 sm:px-6";

/**
 * Public landing page (docs/decisions.md 2026-11-16, layout ideas from PleaseHelp/UBCab, our own
 * look): visitors see what Tuslamj is and real recent activity; acting opens a login sheet that
 * brings them back. Signed-in people go straight to the app.
 */
export default async function Welcome() {
  if (await getViewer()) redirect("/");
  const [t, locale, cfg, recent, online, board] = await Promise.all([getT(), getLocale(), pricingConfig(), recentRequests(5), onlineHelperCount(), openRequests(8)]);
  const now = Date.now();
  // the only price that is ours is the minimum; customers name their own
  const from = (_c: (typeof CATEGORIES)[number]) => minFeeAt(now, cfg);
  const steps = [
    { icon: PenLine, title: t("landing.s1t"), body: t("landing.s1b") },
    { icon: Hand, title: t("landing.s2t"), body: t("landing.s2b") },
    { icon: ShieldCheck, title: t("landing.s3t"), body: t("landing.s3b") },
    { icon: Star, title: t("landing.s4t"), body: t("landing.s4b") },
  ];
  const why = [
    { icon: ShieldCheck, title: t("landing.w1t"), body: t("landing.w1b") },
    { icon: BadgeCheck, title: t("landing.w2t"), body: t("landing.w2b") },
    { icon: Tag, title: t("landing.w3t"), body: t("landing.w3b") },
    { icon: Siren, title: t("landing.w4t"), body: t("landing.w4b") },
  ];

  return (
    <LoginPromptProvider>
      <div className="flex flex-1 flex-col">
        {/* top bar */}
        <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
          <div className={`${wrap} flex min-h-16 items-center gap-6`}>
            <Link href="/welcome" className="flex items-center gap-2 text-[20px] font-extrabold tracking-tight">
              <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-brand text-white">T</span>
              Tuslamj
            </Link>
            <nav className="hidden items-center gap-6 text-[15px] text-ink-2 md:flex">
              <a href="#how" className="hover:text-ink">
                {t("landing.nav.how")}
              </a>
              <a href="#helper" className="hover:text-ink">
                {t("landing.nav.helper")}
              </a>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/login" className="flex min-h-11 items-center px-3 text-[15px] font-semibold">
                {t("landing.nav.login")}
              </Link>
              <LoginGate next="/post" className="press hidden min-h-11 items-center rounded-[14px] bg-brand px-4 text-[15px] font-bold text-white sm:flex">
                {t("landing.nav.post")}
              </LoginGate>
            </div>
          </div>
        </header>

        {/* hero: the question, search, popular starts — and real recent activity beside it */}
        <section className="bg-brand-bg/60">
          <div className={`${wrap} grid gap-8 py-10 md:grid-cols-[1.25fr_1fr] md:items-center md:py-16`}>
            <div className="flex min-w-0 flex-col gap-5">
              <p className="flex w-fit items-center gap-2 rounded-full bg-bg px-3.5 py-1.5 text-[13px] font-medium shadow-card">
                <span aria-hidden className="h-2 w-2 rounded-full bg-held" />
                {online > 0 ? t("landing.areaLive", { n: online }) : t("landing.areaIdle")}
              </p>
              <h1 className="text-[34px] font-extrabold leading-[1.1] tracking-tight text-balance md:text-[52px]">
                {t("landing.title1")}
                <br />
                <span className="text-brand-ink">{t("landing.title2")}</span>
              </h1>
              <p className="max-w-[56ch] text-[16px] leading-relaxed text-ink-2 md:text-[17px]">{t("landing.sub")}</p>
              <LandingSearch />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-ink-2">{t("landing.popular")}</span>
                {POPULAR.map((p) => (
                  <LoginGate
                    key={p.key}
                    next={`/post?cat=${p.cat}&title=${encodeURIComponent(t(`home.pop.${p.key}`))}`}
                    className="press flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-bg px-3.5 text-[14px] font-medium"
                  >
                    <CategoryIcon id={p.cat} size={15} />
                    {t(`home.pop.${p.key}`)}
                  </LoginGate>
                ))}
              </div>
            </div>
            <RecentRequests items={recent} t={t} now={now} />
          </div>
        </section>

        {/* categories with today's starting price */}
        <section className={`${wrap} flex flex-col gap-5 py-12`}>
          <div>
            <h2 className="text-[26px] font-extrabold tracking-tight md:text-[32px]">{t("landing.catsTitle")}</h2>
            <p className="mt-1 text-[15px] text-ink-2">{t("landing.catsSub")}</p>
          </div>
          <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
            {CATEGORIES.map((c) => (
              <LoginGate key={c.id} next={`/post?cat=${c.id}`} className="press flex flex-col items-center gap-2 rounded-tile bg-bg px-2 py-4 text-center shadow-card">
                <CategoryIcon id={c.id} tile size={26} />
                <span className="text-[14px] font-semibold leading-tight">{t(`categoryShort.${c.id}`)}</span>
                <span className="text-[12px] text-ink-2 tabular-nums">{t("home.from", { amount: fmtMoney(from(c)) })}</span>
              </LoginGate>
            ))}
          </div>
        </section>

        {/* requests waiting for a helper — recruits helpers; shown only when there are some */}
        {board.length > 0 && (
          <section className="bg-bg py-12">
            <div className={`${wrap} flex flex-col gap-5`}>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-[26px] font-extrabold tracking-tight md:text-[32px]">{t("landing.boardTitle")}</h2>
                  <p className="mt-1 text-[15px] text-ink-2">{t("landing.boardSub")}</p>
                </div>
                <LoginGate next="/jobs?view=all" className="flex min-h-11 items-center gap-1 text-[15px] font-semibold text-brand-ink">
                  {t("landing.boardAll")} →
                </LoginGate>
              </div>
              <OpenBoard items={board} t={t} locale={locale} />
            </div>
          </section>
        )}

        {/* how it works, 4 steps */}
        <section id="how" className="scroll-mt-20 py-12">
          <div className={`${wrap} flex flex-col gap-6`}>
            <div>
              <h2 className="text-[26px] font-extrabold tracking-tight md:text-[32px]">{t("landing.howTitle")}</h2>
              <p className="mt-1 text-[15px] text-ink-2">{t("landing.howSub")}</p>
            </div>
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <li key={i} className="flex flex-col gap-3 rounded-card bg-bg p-5 shadow-card">
                  <span className="text-[13px] font-bold text-brand-ink">{t("landing.step", { n: i + 1 })}</span>
                  <s.icon aria-hidden size={28} className="text-ink" />
                  <h3 className="text-[18px] font-bold">{s.title}</h3>
                  <p className="text-[14px] leading-relaxed text-ink-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* why us — two-tone heading */}
        <section className={`${wrap} flex flex-col gap-6 py-12`}>
          <h2 className="text-[30px] font-extrabold tracking-tight md:text-[40px]">
            <span className="text-ink-3">{t("landing.whyA")} </span>
            {t("landing.whyB")}
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {why.map((w, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-card bg-bg p-5 shadow-card">
                <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-bg text-brand-ink">
                  <w.icon size={22} />
                </span>
                <h3 className="text-[16px] font-bold leading-snug">{w.title}</h3>
                <p className="text-[13px] text-ink-2">{w.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* become a helper · how prices work */}
        <section id="helper" className={`${wrap} grid scroll-mt-20 gap-3 pb-16 md:grid-cols-2`}>
          <div className="flex flex-col gap-3 rounded-card bg-ink p-6 text-white md:p-8">
            <h2 className="text-[24px] font-extrabold">{t("landing.helperTitle")}</h2>
            <p className="text-[15px] text-white/75">{t("landing.helperBody")}</p>
            <LoginGate next="/helper/apply" className="press mt-2 flex min-h-12 w-fit items-center rounded-[14px] bg-brand px-5 text-[16px] font-bold text-white">
              {t("landing.helperCta")}
            </LoginGate>
          </div>
          <div className="flex flex-col gap-3 rounded-card bg-brand-bg p-6 md:p-8">
            <h2 className="text-[24px] font-extrabold">{t("landing.priceTitle")}</h2>
            <p className="text-[15px] text-ink-2">{t("landing.priceBody")}</p>
          </div>
        </section>

        {/* footer */}
        <footer className="mt-auto bg-ink pb-28 pt-10 text-white/70">
          <div className={`${wrap} flex flex-col gap-4 md:flex-row md:justify-between`}>
            <div className="flex flex-col gap-2">
              <span className="text-[20px] font-extrabold text-white">Tuslamj</span>
              <p className="text-[14px]">{t("landing.footerAbout")}</p>
              <p className="text-[13px]">© 2026 Tuslamj</p>
            </div>
            <nav className="flex gap-5 text-[14px]">
              <Link href="/login" className="hover:text-white">
                {t("landing.nav.login")}
              </Link>
              <Link href="/login?next=/help" className="hover:text-white">
                {t("landing.footerHelp")}
              </Link>
              <a href="#helper" className="hover:text-white">
                {t("landing.nav.helper")}
              </a>
            </nav>
          </div>
        </footer>

        {/* always-there call to action */}
        <div className="fixed inset-x-0 bottom-0 z-30 bg-ink/95 pb-[env(safe-area-inset-bottom)] text-white backdrop-blur">
          <div className={`${wrap} flex min-h-16 items-center justify-between gap-3`}>
            <p className="min-w-0 text-[14px] font-medium md:text-[16px]">{t("landing.bar")}</p>
            <LoginGate next="/post" className={`${btn.primary} min-h-12 flex-none px-4 text-[15px]`}>
              {t("landing.nav.post")}
            </LoginGate>
          </div>
        </div>
      </div>
    </LoginPromptProvider>
  );
}
