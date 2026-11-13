import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Countdown } from "@/components/countdown";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, Card } from "@/components/ui";
import type { T } from "@/i18n";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getPresence, listMyJobs, myOffers, nearbyFeed, type JobListItem } from "@/lib/deals/queries";
import { TERMINAL_STATUSES, errandSplit, type ErrandDeal } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";
import { CATEGORY_ICON } from "@/lib/labels";
import { OnlineCard } from "./online-card";

const earn = (d: ErrandDeal) =>
  errandSplit({ fee: d.fee, itemBudget: 0, receipt: null, serviceFee: d.serviceFee, commissionBps: d.commissionBps }).helperFeeNet;

function JobRow({ item, t, now }: { item: JobListItem; t: T; now: number }) {
  const d = item.deal;
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
        </span>
        {item.expiresAt && (
          <span className="mt-1 block text-sm font-medium text-warn">
            <Countdown until={item.expiresAt} serverNow={now} template={t("job.offerEnds")} />
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
export default async function JobsPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const t = await getT();
  const { profile, actor } = viewer;

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
    const [presence, offers, nearby, mine] = await Promise.all([
      getPresence(profile.id),
      myOffers(profile.id, now),
      nearbyFeed(profile.id),
      listMyJobs(profile.id),
    ]);
    const online = presence?.online ?? false;
    const offered = new Set(offers.map((o) => o.deal.id));
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

        {offers.length > 0 && (
          <section className="flex flex-col gap-2" aria-live="polite">
            <h2 className="font-bold">{t("job.offersTitle")}</h2>
            {offers.map((o) => (
              <JobRow key={o.deal.id} item={o} t={t} now={now} />
            ))}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="font-bold">{t("job.nearbyTitle")}</h2>
          {feed.length === 0 ? (
            <p className="text-[15px] text-ink-2">{t("job.nearbyEmpty")}</p>
          ) : (
            feed.map((n) => <JobRow key={n.deal.id} item={n} t={t} now={now} />)
          )}
        </section>
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
    </>
  );
}
