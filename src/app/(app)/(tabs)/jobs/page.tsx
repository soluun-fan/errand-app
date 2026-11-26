import type { ReactNode } from "react";
import { CalendarClock, ChevronRight, Landmark, MapPin, Users, Zap } from "lucide-react";
import { hasPayout } from "@/lib/payout";
import { helperTodos } from "@/lib/todo";
import { WorkReady } from "@/components/work-ready";
import { deviceCheckBypassed } from "@/lib/work-ready";
import { TodoCard } from "@/components/todo-card";
import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, Card, SegmentedLinks, btn, chipClass } from "@/components/ui";
import type { Locale, T } from "@/i18n";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { browseOpenDeals, getPresence, listMyJobs, myApplications, myOffers, nearbyFeed, type BoardSort, type JobListItem } from "@/lib/deals/queries";
import { LAUNCH_CATEGORIES, OPEN_CATEGORIES, TERMINAL_STATUSES, errandSplit, invitedOnly, type CategoryId, type ErrandDeal } from "@/lib/engine";
import { fmtDateTime, fmtDuration, fmtMoney } from "@/lib/format";
import { TaskMap, type MapMarker } from "@/components/task-map";
import { busyAreas } from "@/lib/busy-areas";
import { fuzz, helperStart } from "@/lib/maps";
import { latestApplication } from "@/lib/kyc";
import { OnlineCard } from "./online-card";
import { NewKindsCard } from "./new-kinds-card";
import { ConditionChips } from "@/components/conditions";
import { firstPhotoUrls } from "@/lib/task-photos";
import { kindCovers } from "@/lib/covers";
import { canUseUnverifiedHelperTest, isActiveTestHelper, unverifiedHelpersTestMode } from "@/lib/helper-test-mode";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("tabs.jobs");

/** Open tasks as price chips on the map, at the approximate (~300 m) spot where the helper starts. */
function jobPins(items: JobListItem[]): MapMarker[] {
  return items.flatMap(({ deal }) => {
    const start = helperStart(deal);
    return start ? [{ ...fuzz(start), kind: "job" as const, label: fmtMoney(earn(deal)), href: `/jobs/${deal.id}` }] : [];
  });
}

const earn = (d: ErrandDeal) =>
  errandSplit({ fee: d.fee, itemBudget: 0, receipt: null, serviceFee: d.serviceFee, commissionBps: d.commissionBps }).helperFeeNet;

/**
 * One open request (PleaseHelp-style card): tags, title, where and when, then a line and the
 * helper's fee big and orange — scannable in a list.
 */
/** A card's picture: the customer's own first photo, or the kind's example cover (labelled as such). */
type Pic = { url: string; example: boolean } | null;
type Pics = { own: Map<string, string>; covers: Map<CategoryId, string> };
const picOf = (d: ErrandDeal, p: Pics): Pic =>
  p.own.get(d.id) ? { url: p.own.get(d.id) as string, example: false } : p.covers.get(d.category) ? { url: p.covers.get(d.category) as string, example: true } : null;
async function loadPics(items: readonly JobListItem[]): Promise<Pics> {
  const [own, covers] = await Promise.all([firstPhotoUrls(items.map((i) => i.deal.id)), kindCovers()]);
  return { own, covers };
}

function JobRow({ item, t, now = 0, locale = "mn", mine, pic = null }: { item: JobListItem; t: T; now?: number; locale?: Locale; mine?: readonly CategoryId[]; pic?: Pic }) {
  const d = item.deal;
  const outside = mine !== undefined && !mine.includes(d.category);
  const full = d.offers.length >= d.maxApplicants;
  const dur = d.details.minutes >= 60 ? t("price.hours", { n: d.details.minutes / 60 }) : t("price.min", { n: d.details.minutes });
  const tag = "inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-caption font-semibold";
  return (
    <Link href={`/jobs/${d.id}`} className="press flex flex-col gap-2.5 rounded-card bg-bg p-4 shadow-card">
      <span className="flex flex-wrap gap-1.5">
        <span className={`${tag} bg-fill text-ink-2`}>
          <CategoryIcon id={d.category} size={13} />
          {t(`categoryShort.${d.category}`)}
        </span>
        {d.status === "open" && d.invite && invitedOnly(d, now) !== null ? (
          <span className={`${tag} bg-brand text-white`}>{t("invite.badge")}</span>
        ) : (
          d.status === "open" && <span className={`${tag} ${full ? "bg-fill text-ink-2" : "bg-brand-bg text-brand-ink"}`}>{full ? t("job.full") : t("job.available")}</span>
        )}
        {/* a team job, said up front (PleaseHelp "2 helpers wanted") */}
        {d.details.people === 2 && (
          <span className={`${tag} bg-fill text-ink-2`}>
            <Users aria-hidden size={13} />
            {t("details.people", { n: 2 })}
          </span>
        )}
        {d.itemBudget > 0 && <span className={`${tag} bg-fill text-ink-2`}>{t("job.buysItems", { amount: fmtMoney(d.itemBudget) })}</span>}
        {outside && <span className={`${tag} bg-fill text-ink-2`}>{t("job.notYourCategory")}</span>}
      </span>
      <ConditionChips variety={d.details.variety} require={d.details.require} t={t} />
      <span className="flex gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-2.5">
          <span className="line-clamp-2 text-lead font-bold leading-snug">{d.title}</span>
          <span className="flex flex-col gap-1 text-meta text-ink-2">
            <span className="flex items-center gap-1.5">
              <MapPin aria-hidden size={14} className="flex-none text-brand-ink" />
              {item.distanceKm === null ? t("job.noPin") : t("job.away", { km: item.distanceKm.toFixed(1) })}
              {d.details.km > 0 ? ` · ${t("job.trip", { km: d.details.km.toFixed(1) })}` : ""}
            </span>
            {d.scheduledAt || (d.mode === "schedule" && d.matchBy) ? (
              <span className="flex items-center gap-1.5">
                <CalendarClock aria-hidden size={14} className="flex-none" />
                {d.scheduledAt ? fmtDateTime(d.scheduledAt, locale) : t("task.whenFlexibleUntil", { time: fmtDateTime(d.matchBy as number, locale) })} · {dur}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Zap aria-hidden size={14} className="flex-none text-brand-ink" />
                <b className="font-semibold text-brand-ink">{t("task.whenNow")}</b> · {dur}
                {/* a "now" job closes at its match deadline: say how long is left */}
                {d.status === "open" && d.matchBy !== null && now > 0 && d.matchBy > now && (
                  <span className="text-ink-2"> · {t("job.closesIn", { time: fmtDuration(d.matchBy - now, t) })}</span>
                )}
              </span>
            )}
          </span>
        </span>
        {pic && <Thumb pic={pic} t={t} />}
      </span>
      <span className="flex items-end justify-between gap-3 border-t border-line pt-2.5">
        <span className="flex flex-col">
          <span className="text-meta font-medium text-ink-2">{t("job.feeLabel")}</span>
          <span className="text-title-lg font-extrabold leading-tight tabular-nums text-brand-ink">{fmtMoney(earn(d))}</span>
        </span>
        {d.offers.length > 0 && <span className="pb-0.5 text-meta font-semibold text-route">{t("job.applicants", { n: d.offers.length })}</span>}
      </span>
    </Link>
  );
}

/** 88 px picture on a card; an example cover says so, so nobody mistakes it for the real job. */
function Thumb({ pic, t }: { pic: NonNullable<Pic>; t: T }) {
  return (
    <span className="relative h-[88px] w-[88px] flex-none overflow-hidden rounded-input bg-fill">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed / public storage URL */}
      <img src={pic.url} alt="" loading="lazy" className="h-full w-full object-cover" />
      {pic.example && <span className="absolute inset-x-0 bottom-0 bg-ink/60 px-1 py-0.5 text-center text-tiny font-medium text-white">{t("job.examplePic")}</span>}
    </span>
  );
}

/**
 * Helper mode home. Approved helpers get the job feed (CLAUDE.md §10 step 4, next);
 * everyone else sees the verification checklist (UI-FLOWS H1) with honest statuses.
 */
/** "Бүх ажил": every open post in the city, with category + sort filters (links, so it works without JS). */
async function Board({ sp, viewerId, from, mine, t, locale }: {
  sp: { cat?: string | string[]; sort?: string | string[]; when?: string | string[] };
  viewerId: string;
  from: { lat: number; lng: number } | null;
  mine: readonly CategoryId[];
  t: T;
  locale: Locale;
}) {
  const cat = LAUNCH_CATEGORIES.find((c) => c.id === sp.cat)?.id;
  const sort: BoardSort = sp.sort === "new" || sp.sort === "pay" ? sp.sort : from ? "near" : "new";
  // Now / scheduled (PleaseHelp-style): a helper free right now wants the "now" jobs first
  const when = sp.when === "now" || sp.when === "later" ? sp.when : undefined;
  const items = (await browseOpenDeals(viewerId, { category: cat, sort, from })).filter(
    (i) => !when || (when === "now") === (i.deal.scheduledAt === null && i.deal.mode !== "schedule"),
  );
  const pics = await loadPics(items);
  const href = (p: { cat?: string; sort?: string; when?: string }) => {
    const q = new URLSearchParams({ view: "all" });
    const c = "cat" in p ? p.cat : cat;
    const s = p.sort ?? sort;
    const w = "when" in p ? p.when : when;
    if (c) q.set("cat", c);
    if (w) q.set("when", w);
    q.set("sort", s);
    return `/jobs?${q}`;
  };
  return (
    <section className="flex flex-col gap-3">
      <nav aria-label={t("job.filter")} className="-mx-5 flex gap-2 overflow-x-auto px-5">
        <Link href={href({ cat: undefined })} aria-current={!cat ? "page" : undefined} className={chipClass(!cat)}>
          {t("home.all")}
        </Link>
        {LAUNCH_CATEGORIES.map((c) => (
          <Link key={c.id} href={href({ cat: c.id })} aria-current={cat === c.id ? "page" : undefined} className={chipClass(cat === c.id)}>
            <CategoryIcon id={c.id} size={16} /> {t(`categoryShort.${c.id}`)}
          </Link>
        ))}
      </nav>
      <nav aria-label={t("job.sort")} className="-mx-5 flex items-center gap-2 overflow-x-auto px-5">
        {(["now", "later"] as const).map((w) => (
          <Link key={w} href={href({ when: when === w ? undefined : w })} aria-current={when === w ? "page" : undefined} className={chipClass(when === w)}>
            {w === "now" ? <Zap aria-hidden size={14} /> : <CalendarClock aria-hidden size={14} />} {t(`job.when_${w}`)}
          </Link>
        ))}
        <span aria-hidden className="mx-1 h-6 w-px flex-none bg-line" />
        {(["near", "new", "pay"] as const).map((s) =>
          s === "near" && !from ? null : (
            <Link key={s} href={href({ sort: s })} aria-current={sort === s ? "page" : undefined} className={chipClass(sort === s)}>
              {t(`job.sort_${s}`)}
            </Link>
          ),
        )}
      </nav>
      <TaskMap markers={jobPins(items)} showMe className="h-64" />
      {items.length === 0 ? (
        <p className="text-body text-ink-2">{t("job.allEmpty")}</p>
      ) : (
        items.map((i) => <JobRow key={i.deal.id} item={i} t={t} now={Date.now()} locale={locale} mine={mine} pic={picOf(i.deal, pics)} />)
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

  /** `status`: the online pill (approved helpers) — always in sight, like PleaseHelp's header switch. */
  const pageHeader = (status?: ReactNode) => (
    <header className="flex items-center justify-between gap-3 pt-2">
      <h1 className="text-headline font-bold tracking-tight">{actor.helperApproved ? t("tabs.jobs") : t("helper.becomeTitle")}</h1>
      <span className="flex items-center gap-2">
        {status}
        <Link href="/profile" aria-label={t("home.profile")} className="md:hidden">
          <Avatar name={profile.name || "?"} size={44} />
        </Link>
      </span>
    </header>
  );
  const header = pageHeader();
  // no bank account, no work: customers pay the helper straight into it (docs/decisions.md 2026-11-18)
  if (actor.helperApproved && !isActiveTestHelper(profile) && !(await hasPayout(profile.id))) {
    return (
      <>
        {header}
        <section className="flex flex-col gap-3 rounded-card bg-bg p-5 shadow-card">
          <Landmark aria-hidden size={28} className="text-brand-ink" />
          <h2 className="text-title font-bold">{t("payout.gateTitle")}</h2>
          <p className="text-body text-ink-2">{t("payout.gateBody")}</p>
          <Link href="/helper/bank" className={`${btn.primary} w-full`}>
            {t("payout.add")}
          </Link>
        </section>
      </>
    );
  }
  const todos = await helperTodos(viewer);
  if (actor.helperApproved) {
    const now = Date.now();
    const [presence, offersAll, nearby, mine, applied, busy] = await Promise.all([
      getPresence(profile.id),
      myOffers(profile.id, now),
      view === "near" ? nearbyFeed(profile.id) : Promise.resolve([]),
      listMyJobs(profile.id),
      myApplications(profile.id),
      // where tasks are waiting across the city (coarse squares); never blocks the page
      view === "near" ? busyAreas().catch(() => []) : Promise.resolve([]),
    ]);
    const appliedIds = new Set(applied.map((a) => a.deal.id));
    const offers = offersAll.filter((o) => !appliedIds.has(o.deal.id));
    const online = presence?.online ?? false;
    const from = presence?.lat != null && presence.lng != null ? { lat: presence.lat, lng: presence.lng } : null;
    const offered = new Set([...offers.map((o) => o.deal.id), ...appliedIds]);
    const feed = nearby.filter((n) => !offered.has(n.deal.id));
    const active = mine.filter((d) => !TERMINAL_STATUSES.includes(d.status));
    const pics = await loadPics([...applied, ...offers, ...feed]);
    return (
      <>
        {pageHeader(
          <a
            href="#online"
            className={`flex min-h-10 items-center gap-2 rounded-full px-3.5 text-small font-semibold ${online ? "bg-held-bg text-held" : "bg-fill text-ink-2"}`}
          >
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${online ? "bg-held" : "bg-ink-3"}`} />
            {online ? t("job.pillOnline", { km: presence?.radiusKm ?? 3 }) : t("job.offline")}
          </a>,
        )}
        <AutoRefresh seconds={online ? 10 : 30} />
        {/* order (2026-11-24): the job you are doing → offers waiting for you → to-dos → online → your applications → the feed */}
        {active.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-bold">{t("job.activeTitle")}</h2>
            {active.map((d) => (
              <Link key={d.id} href={`/jobs/${d.id}`} className="press grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-card bg-bg p-3 shadow-card">
                <CategoryIcon id={d.category} tile size={20} />
                <span className="min-w-0 break-words text-title font-semibold">{d.title}</span>
                <ChevronRight aria-hidden size={18} className="flex-none text-ink-2" />
                <div className="col-start-2 -mt-1.5"><StatusBadge status={d.status} t={t} /></div>
              </Link>
            ))}
          </section>
        )}

        {offers.length > 0 && (
          <section className="flex flex-col gap-2" aria-live="polite">
            <h2 className="font-bold">{t("job.offersTitle")}</h2>
            {offers.map((o) => (
              <JobRow key={o.deal.id} item={o} t={t} now={now} locale={locale} pic={picOf(o.deal, pics)} />
            ))}
          </section>
        )}

        <TodoCard items={todos} t={t} />
        {/* a phone with notifications and location on, or no work (owner, 2026-11-18) */}
        <div id="online" className="scroll-mt-20">
          <WorkReady enforce={!online && !(await deviceCheckBypassed(profile))}>
            <OnlineCard online={online} radiusKm={presence?.radiusKm ?? 3} />
          </WorkReady>
        </div>
        {applied.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-bold">{t("job.myRequests")}</h2>
            {applied.map((a) => (
              <JobRow key={a.deal.id} item={a} t={t} now={now} locale={locale} pic={picOf(a.deal, pics)} />
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
            <TaskMap markers={[...busy.map((c) => ({ lat: c.lat, lng: c.lng, kind: "busy" as const, label: String(c.count) })), ...jobPins([...offers, ...applied, ...feed])]} showMe className="h-64" />
            {busy.length > 0 && <p className="text-meta text-ink-2">{t("job.busyLegend")}</p>}
            {feed.length === 0 ? (
              <p className="text-body text-ink-2">
                {t("job.nearbyEmpty")}{" "}
                <Link href="/jobs?view=all" className="font-semibold text-ink underline underline-offset-4">
                  {t("job.seeAll")}
                </Link>
              </p>
            ) : (
              feed.map((n) => <JobRow key={n.deal.id} item={n} t={t} now={now} locale={locale} pic={picOf(n.deal, pics)} />)
            )}
          </section>
        )}
        <NewKindsCard key={profile.id} userId={profile.id} missing={OPEN_CATEGORIES.filter((c) => !(actor.categories ?? []).includes(c))} />
      </>
    );
  }

  if (unverifiedHelpersTestMode) {
    const canJoin = canUseUnverifiedHelperTest();
    return (
      <>
        {header}
        <p className="rounded-card bg-warn-bg p-4 text-body text-warn">{t("kyc.testWarning")}</p>
        <p className="text-body text-ink-2">{t(canJoin ? "kyc.testJoinHint" : "kyc.testInviteOnly")}</p>
        {canJoin && (
          <Link href="/helper/apply" className={`${btn.primary} w-full`}>
            {t("kyc.testTitle")}
          </Link>
        )}
        <h2 className="font-bold">{t("job.boardTitle")}</h2>
        <p className="-mt-2 text-small text-ink-2">{t("job.boardSub")}</p>
        <Board sp={sp} viewerId={profile.id} from={null} mine={actor.categories ?? []} t={t} locale={locale} />
      </>
    );
  }

  const app = await latestApplication(profile.id);
  const pending = app?.status === "submitted";
  const chip = (state: "done" | "inReview" | "needed") => (
    <span
      className={`rounded-full px-2.5 py-1 text-caption font-semibold ${
        state === "done" ? "bg-held-bg text-held" : state === "inReview" ? "bg-warn-bg text-warn" : "bg-fill text-ink-2"
      }`}
    >
      {t(`helper.${state}`)}
    </span>
  );
  const step = (done: boolean): "done" | "inReview" | "needed" => (done ? "done" : pending ? "inReview" : "needed");
  const rows: [string, "done" | "inReview" | "needed"][] = [
    [t("helper.stepPhone"), profile.phone ? "done" : "needed"],
    [t("helper.stepDan"), step(profile.kyc_level >= 3)],
    [t("helper.stepSelfie"), step(profile.kyc_level >= 3)],
    [t("helper.stepPayout"), step(profile.kyc_level >= 3)],
  ];

  return (
    <>
      {header}
      <TodoCard items={todos} t={t} />
      <p className="text-lead text-ink-2">{t("helper.becomeBody")}</p>
      <Card>
        <h2 className="font-bold">{t("helper.checklist")}</h2>
        <ul className="flex flex-col divide-y divide-line">
          {rows.map(([label, state]) => (
            <li key={label}>
              {state === "needed" && !pending ? (
                <Link href="/helper/apply" className="press flex min-h-12 items-center justify-between gap-3">
                  <span className="text-body">{label}</span>
                  {/* needed → one clear button to the form (not a grey label you can't act on) */}
                  <span className="flex-none whitespace-nowrap rounded-full bg-brand px-3 py-1.5 text-meta font-bold text-white">{t("helper.stepGo")} ›</span>
                </Link>
              ) : (
                <span className="flex min-h-12 items-center justify-between gap-3">
                  <span className="text-body">{label}</span>
                  {chip(state)}
                </span>
              )}
            </li>
          ))}
        </ul>
        {app && <p className="text-small text-ink-2">{t(`kyc.status.${app.status}`)}</p>}
        {app?.decisionNote && <p className="text-small text-ink-2">{t("kyc.note", { note: app.decisionNote })}</p>}
        {!pending && (
          <Link href="/helper/apply" className={`${btn.primary} w-full`}>
            {app ? t("kyc.again") : t("kyc.start")}
          </Link>
        )}
      </Card>
      <h2 className="font-bold">{t("job.boardTitle")}</h2>
      <p className="-mt-2 text-small text-ink-2">{t("job.boardSub")}</p>
      <Board sp={sp} viewerId={profile.id} from={null} mine={actor.categories ?? []} t={t} locale={locale} />
    </>
  );
}
