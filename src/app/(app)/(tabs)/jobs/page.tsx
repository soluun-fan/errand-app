import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, Card, SegmentedLinks, chipClass } from "@/components/ui";
import type { Locale, T } from "@/i18n";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { browseOpenDeals, getPresence, listMyJobs, myApplications, myOffers, nearbyFeed, type BoardSort, type JobListItem } from "@/lib/deals/queries";
import { CATEGORIES, TERMINAL_STATUSES, errandSplit, type CategoryId, type ErrandDeal } from "@/lib/engine";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { CATEGORY_ICON } from "@/lib/labels";
import { OnlineCard } from "./online-card";

const earn = (d: ErrandDeal) =>
  errandSplit({ fee: d.fee, itemBudget: 0, receipt: null, serviceFee: d.serviceFee, commissionBps: d.commissionBps }).helperFeeNet;

function JobRow({ item, t, locale, mine }: { item: JobListItem; t: T; now?: number; locale?: Locale; mine?: readonly CategoryId[] }) {
  const d = item.deal;
  const outside = mine !== undefined && !mine.includes(d.category);
  return (
    <Link href={`/jobs/${d.id}`} className="press flex items-center gap-3 rounded-card border border-line bg-bg p-3">
      <span aria-hidden className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-fill text-2xl">
        {CATEGORY_ICON[d.category]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-semibold">{d.title}</span>
        <span className="block text-sm text-ink-2">
          {item.distanceKm === null ? t("job.noPin") : t("job.away", { km: item.distanceKm.toFixed(1) })}
          {d.itemBudget > 0 ? ` · 🛍️ ${fmtMoney(d.itemBudget)}` : ""}
          {locale ? ` · ${fmtDateTime(d.createdAt, locale)}` : ""}
        </span>
        {outside && <span className="mt-1 inline-block rounded-full bg-fill px-2 py-0.5 text-xs font-medium text-ink-2">{t("job.notYourCategory")}</span>}
        {d.offers.length > 0 && (
          <span className="mt-1 block text-sm font-medium text-ink-2">
            {t("job.applicants", { n: d.offers.length })}
            {d.offers.length >= d.maxApplicants ? ` · ${t("job.full")}` : ""}
          </span>
        )}
      </span>
      <span className="flex-none text-right text-[17px] font-bold tabular-nums">{fmtMoney(earn(d))}</span>
    </Link>
  );
}

/**
 * Helper mode home. Approved helpers get the job feed (CLAUDE.md §10 step 4, next);
 * everyone else sees the verification checklist (UI-FLOWS H1) with honest statuses.
 */
/** "Бүх ажил": every open post in the city, with category + sort filters (links, so it works without JS). */
async function Board({ sp, viewerId, from, mine, t, locale }: {
  sp: { cat?: string | string[]; sort?: string | string[] };
  viewerId: string;
  from: { lat: number; lng: number } | null;
  mine: readonly CategoryId[];
  t: T;
  locale: Locale;
}) {
  const cat = CATEGORIES.find((c) => c.id === sp.cat)?.id;
  const sort: BoardSort = sp.sort === "new" || sp.sort === "pay" ? sp.sort : from ? "near" : "new";
  const items = await browseOpenDeals(viewerId, { category: cat, sort, from });
  const href = (p: { cat?: string; sort?: string }) => {
    const q = new URLSearchParams({ view: "all" });
    const c = "cat" in p ? p.cat : cat;
    const s = p.sort ?? sort;
    if (c) q.set("cat", c);
    q.set("sort", s);
    return `/jobs?${q}`;
  };
  return (
    <section className="flex flex-col gap-3">
      <nav aria-label={t("job.filter")} className="-mx-5 flex gap-2 overflow-x-auto px-5">
        <Link href={href({ cat: undefined })} aria-current={!cat ? "page" : undefined} className={chipClass(!cat)}>
          {t("home.all")}
        </Link>
        {CATEGORIES.map((c) => (
          <Link key={c.id} href={href({ cat: c.id })} aria-current={cat === c.id ? "page" : undefined} className={chipClass(cat === c.id)}>
            <span aria-hidden>{CATEGORY_ICON[c.id]}</span> {t(`categoryShort.${c.id}`)}
          </Link>
        ))}
      </nav>
      <nav aria-label={t("job.sort")} className="flex gap-2">
        {(["near", "new", "pay"] as const).map((s) =>
          s === "near" && !from ? null : (
            <Link key={s} href={href({ sort: s })} aria-current={sort === s ? "page" : undefined} className={chipClass(sort === s)}>
              {t(`job.sort_${s}`)}
            </Link>
          ),
        )}
      </nav>
      {items.length === 0 ? (
        <p className="text-[15px] text-ink-2">{t("job.allEmpty")}</p>
      ) : (
        items.map((i) => <JobRow key={i.deal.id} item={i} t={t} now={Date.now()} locale={locale} mine={mine} />)
      )}
    </section>
  );
}

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [t, locale, sp] = await Promise.all([getT(), getLocale(), searchParams]);
  const { profile, actor } = viewer;
  const view = sp.view === "all" ? "all" : "near";

  const header = (
    <header className="flex items-center justify-between pt-2">
      <h1 className="text-[28px] font-bold">{actor.helperApproved ? t("tabs.jobs") : t("helper.becomeTitle")}</h1>
      <Link href="/profile" aria-label={t("home.profile")}>
        <Avatar name={profile.name || "?"} size={44} />
      </Link>
    </header>
  );
  if (actor.helperApproved) {
    const now = Date.now();
    const [presence, offersAll, nearby, mine, applied] = await Promise.all([
      getPresence(profile.id),
      myOffers(profile.id, now),
      view === "near" ? nearbyFeed(profile.id) : Promise.resolve([]),
      listMyJobs(profile.id),
      myApplications(profile.id),
    ]);
    const appliedIds = new Set(applied.map((a) => a.deal.id));
    const offers = offersAll.filter((o) => !appliedIds.has(o.deal.id));
    const online = presence?.online ?? false;
    const from = presence?.lat != null && presence.lng != null ? { lat: presence.lat, lng: presence.lng } : null;
    const offered = new Set([...offers.map((o) => o.deal.id), ...appliedIds]);
    const feed = nearby.filter((n) => !offered.has(n.deal.id));
    const active = mine.filter((d) => !TERMINAL_STATUSES.includes(d.status));
    return (
      <>
        {header}
        <AutoRefresh seconds={online ? 10 : 30} />
        <OnlineCard online={online} radiusKm={presence?.radiusKm ?? 3} />

        {active.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-bold">{t("job.activeTitle")}</h2>
            {active.map((d) => (
              <Link key={d.id} href={`/jobs/${d.id}`} className="press flex items-center gap-3 rounded-card border border-line p-3">
                <span aria-hidden className="text-2xl">
                  {CATEGORY_ICON[d.category]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{d.title}</span>
                <StatusBadge status={d.status} t={t} />
              </Link>
            ))}
          </section>
        )}

        {applied.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-bold">{t("job.myRequests")}</h2>
            {applied.map((a) => (
              <JobRow key={a.deal.id} item={a} t={t} />
            ))}
          </section>
        )}

        {offers.length > 0 && (
          <section className="flex flex-col gap-2" aria-live="polite">
            <h2 className="font-bold">{t("job.offersTitle")}</h2>
            {offers.map((o) => (
              <JobRow key={o.deal.id} item={o} t={t} now={now} />
            ))}
          </section>
        )}

        <SegmentedLinks
          current={view}
          items={[
            { key: "near", href: "/jobs", label: t("job.viewNear") },
            { key: "all", href: "/jobs?view=all", label: t("job.viewAll") },
          ]}
        />
        {view === "all" ? (
          <Board sp={sp} viewerId={profile.id} from={from} mine={actor.categories ?? []} t={t} locale={locale} />
        ) : (
          <section className="flex flex-col gap-2">
            {feed.length === 0 ? (
              <p className="text-[15px] text-ink-2">
                {t("job.nearbyEmpty")}{" "}
                <Link href="/jobs?view=all" className="font-semibold text-ink underline underline-offset-4">
                  {t("job.seeAll")}
                </Link>
              </p>
            ) : (
              feed.map((n) => <JobRow key={n.deal.id} item={n} t={t} now={now} />)
            )}
          </section>
        )}
      </>
    );
  }

  const pending = profile.helper_status === "pending";
  const chip = (state: "done" | "inReview" | "needed") => (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        state === "done" ? "bg-held-bg text-held" : state === "inReview" ? "bg-warn-bg text-warn" : "bg-fill text-ink-2"
      }`}
    >
      {t(`helper.${state}`)}
    </span>
  );
  const rows: [string, "done" | "inReview" | "needed"][] = [
    [t("helper.stepPhone"), profile.phone ? "done" : "needed"],
    [t("helper.stepDan"), profile.kyc_level >= 2 ? "done" : pending ? "inReview" : "needed"],
    [t("helper.stepSelfie"), profile.kyc_level >= 3 ? (pending ? "inReview" : "done") : "needed"],
    [t("helper.stepPayout"), profile.kyc_level >= 3 ? (pending ? "inReview" : "done") : "needed"],
  ];

  return (
    <>
      {header}
      <p className="text-[16px] text-ink-2">{t("helper.becomeBody")}</p>
      <Card>
        <h2 className="font-bold">{t("helper.checklist")}</h2>
        <ul className="flex flex-col divide-y divide-line">
          {rows.map(([label, state]) => (
            <li key={label} className="flex min-h-12 items-center justify-between gap-3">
              <span className="text-[15px]">{label}</span>
              {chip(state)}
            </li>
          ))}
        </ul>
        {pending && <p className="text-sm text-ink-2">{t("helper.pendingBody")}</p>}
      </Card>
      <h2 className="font-bold">{t("job.boardTitle")}</h2>
      <p className="-mt-2 text-sm text-ink-2">{t("job.boardSub")}</p>
      <Board sp={sp} viewerId={profile.id} from={null} mine={actor.categories ?? []} t={t} locale={locale} />
    </>
  );
}
