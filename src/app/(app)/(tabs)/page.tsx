import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, MapPin, Plus, RotateCcw, Search, ShieldCheck, Undo2 } from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { DealCard } from "@/components/deal-card";
import { RecentRequests } from "@/components/recent-requests";
import { Avatar, PrimaryBar, btn, chipClass } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { listMyTasks, walletEntries } from "@/lib/deals/queries";
import { fmtMoney } from "@/lib/format";
import { CATEGORIES, minFeeAt, type CategoryId } from "@/lib/engine";
import { getMode } from "@/lib/mode";
import { POPULAR } from "@/lib/popular";
import { pricingConfig } from "@/lib/pricing";
import { onlineHelperCount, recentRequests } from "@/lib/public-snapshot";
import { DraftChip } from "./draft-chip";

const REFUND_KINDS = ["refund", "budget_refund"];
/** Past tasks shown straight away; the rest open in place ("Show all"), no separate page. */
const PAST_SHOWN = 3;

/**
 * Home (redesign 2026-11-16, docs/ui.md): task first — greeting, "what do you need?", search, live
 * tasks, six categories with today's starting price, money card, past tasks with "Order again",
 * and the main button fixed in thumb reach. The customer's only tab.
 */
export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) return null;
  if ((await getMode()) === "helper") redirect("/jobs");
  const [t, locale, all, entries] = await Promise.all([getT(), getLocale(), listMyTasks(viewer.profile.id), walletEntries(viewer.profile.id)]);
  const closed = ["released", "refunded", "cancelled", "expired"];
  const active = all.filter((x) => !closed.includes(x.deal.status));
  const past = all.filter((x) => closed.includes(x.deal.status));
  const holding = all.filter((x) => x.deal.heldAmount > 0);
  const heldNow = holding.reduce((a, x) => a + x.deal.heldAmount, 0);
  const refunds = entries.filter((e) => REFUND_KINDS.includes(e.kind) && e.amount > 0).reduce((a, e) => a + e.amount, 0);
  const pastRow = (x: (typeof past)[number]) => (
    <DealCard
      key={x.deal.id}
      deal={x.deal}
      t={t}
      locale={locale}
      row
      rowAction={
        <Link href={`/post?again=${x.deal.id}`} className="flex min-h-11 items-center gap-1.5 px-1 text-[14px] font-semibold text-brand-ink">
          <RotateCcw aria-hidden size={16} /> {t("deal.postAgain")}
        </Link>
      }
    />
  );
  const everCompleted = all.some((x) => x.deal.status === "released");
  const repeat = [...new Map(all.filter((x) => x.deal.status === "released").map((x) => [x.deal.title, x.deal])).values()].slice(0, 3);

  // "from" price per category: the engine's build-up price for a usual job of that kind, today
  const [cfg, recent, online] = await Promise.all([pricingConfig(), recentRequests(4), onlineHelperCount()]);
  const now = Date.now();
  // the only price that is ours: the minimum (the customer names the rest; docs/decisions.md 2026-11-16)
  const fromPrice = (_c: CategoryId) => minFeeAt(now, cfg);
  const name = viewer.profile.name?.split(" ")[0];

  return (
    <>
      {/* greeting + profile */}
      <header className="flex items-center justify-between pt-2">
        <p className="text-[14px] text-ink-2">
          {name ? t("home.hello") : t("home.greetingAnon")}
          {name && <b className="block text-[17px] text-ink">{name}</b>}
        </p>
        <Link href="/profile" aria-label={t("home.profile")} className="press rounded-full">
          <Avatar name={viewer.profile.name || "?"} size={44} />
        </Link>
      </header>

      {/* where + how alive it is (real numbers only) */}
      <Link href="/profile" className="flex w-fit items-center gap-1.5 rounded-full bg-bg px-3 py-1.5 text-[13px] font-medium shadow-card">
        <MapPin aria-hidden size={14} className="text-brand-ink" />
        {viewer.profile.area || t("home.area")}
        {online > 0 && <span className="text-ink-2">· {t("home.online", { n: online })}</span>}
      </Link>

      {/* task first: the question, then search (Enter or → starts posting with it) */}
      <h1 className="text-[24px] font-bold leading-tight tracking-tight">{t("home.hero")}</h1>
      <form action="/post" className="flex min-h-14 items-center gap-2 rounded-[18px] bg-bg pl-4 pr-1.5 shadow-float">
        <Search aria-hidden size={20} className="flex-none text-ink-2" />
        <label htmlFor="q" className="sr-only">
          {t("home.search")}
        </label>
        <input id="q" name="title" maxLength={40} placeholder={t("home.search")} className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-3" />
        <button aria-label={t("home.heroGo")} className="press flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-brand text-white">
          <ArrowRight aria-hidden size={20} />
        </button>
      </form>

      {/* quick starts: an unfinished draft, your repeats, then popular tasks */}
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        <DraftChip />
        {repeat.map((d) => (
          <Link key={d.id} href={`/post?cat=${d.category}&title=${encodeURIComponent(d.title)}`} className={chipClass(false)}>
            <RotateCcw aria-hidden size={14} />
            {d.title}
          </Link>
        ))}
        {POPULAR.map((p) => (
          <Link key={p.key} href={`/post?cat=${p.cat}&title=${encodeURIComponent(t(`home.pop.${p.key}`))}`} className={chipClass(false)}>
            <CategoryIcon id={p.cat} size={15} />
            {t(`home.pop.${p.key}`)}
          </Link>
        ))}
      </div>

      {/* live tasks first: the one thing that matters right now */}
      {active.map((x) => (
        <DealCard key={x.deal.id} deal={x.deal} offerCount={x.offerCount} t={t} locale={locale} />
      ))}

      {/* six big categories with today's starting price */}
      <nav aria-label={t("post.category")} className="grid grid-cols-3 gap-2.5">
        {CATEGORIES.map(({ id }) => (
          <Link key={id} href={`/post?cat=${id}`} className="press flex flex-col gap-2 rounded-tile bg-bg p-3 shadow-card">
            <CategoryIcon id={id} tile size={20} />
            <span className="text-[14px] font-semibold leading-tight">{t(`categoryShort.${id}`)}</span>
            <span className="-mt-1.5 text-[12px] text-ink-2 tabular-nums">{t("home.from", { amount: fmtMoney(fromPrice(id)) })}</span>
          </Link>
        ))}
      </nav>

      <RecentRequests items={recent} t={t} now={now} />

      {(heldNow > 0 || refunds > 0) && (
        <div className={`grid gap-2.5 ${heldNow > 0 && refunds > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
          {heldNow > 0 && (
          <div className="flex flex-col gap-1 rounded-card bg-held-bg p-4 text-held">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <ShieldCheck aria-hidden size={16} /> {t("wallet.heldNow")}
            </span>
            <span className="text-[20px] font-bold tabular-nums">{fmtMoney(heldNow)}</span>
            <span className="text-[13px]">{t("wallet.heldNowSub", { n: holding.length })}</span>
          </div>
          )}
          {refunds > 0 && (
          <div className="flex flex-col gap-1 rounded-card bg-bg p-4 shadow-card">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink-2">
              <Undo2 aria-hidden size={16} /> {t("wallet.refunds")}
            </span>
            <span className="text-[20px] font-bold tabular-nums">{fmtMoney(refunds)}</span>
            <span className="text-[13px] text-ink-2">{t("wallet.refundsSub")}</span>
          </div>
          )}
        </div>
      )}

      <Link href="/help" className="flex items-start gap-2 text-[14px] font-medium text-held">
        <ShieldCheck aria-hidden size={18} className="mt-0.5 flex-none" />
        <span>
          {t("home.trust")} <span className="underline underline-offset-2">{t("home.howItWorks")}</span>
        </span>
      </Link>

      {!everCompleted && (
        <section className="-mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="w-60 flex-none snap-start rounded-card bg-bg p-4 shadow-card">
              <p className="font-semibold">{t(`home.explainer${n}Title`)}</p>
              <p className="mt-1 text-[14px] text-ink-2">{t(`home.explainer${n}Body`)}</p>
            </div>
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-bold">{t("home.past")}</h2>
          <div className="flex flex-col rounded-card bg-bg px-4 shadow-card">
            {past.slice(0, PAST_SHOWN).map(pastRow)}
            {past.length > PAST_SHOWN && (
              <details className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center text-[14px] font-semibold text-brand-ink">
                  <span className="group-open:hidden">{t("home.pastAll", { n: past.length })}</span>
                  <span className="hidden group-open:inline">{t("home.pastLess")}</span>
                </summary>
                {past.slice(PAST_SHOWN).map(pastRow)}
              </details>
            )}
          </div>
        </section>
      )}

      {/* the main action, always in thumb reach */}
      <PrimaryBar>
        <Link href="/post" className={`${btn.primary} w-full`}>
          <Plus aria-hidden size={20} strokeWidth={2.5} /> {t("home.postCta")}
        </Link>
      </PrimaryBar>
    </>
  );
}
