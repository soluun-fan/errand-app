import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Countdown } from "@/components/countdown";
import { InlineAction } from "@/components/inline-action";
import { JobBeacon } from "@/components/job-beacon";
import { TaskMap, type MapMarker } from "@/components/task-map";
import { ConfirmSheet } from "@/components/sheet";
import { StatusBadge } from "@/components/status-badge";
import { Card, FlowHeader, HeldBadge, Note, PrimaryBar, btn, field, fieldLabel } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getJobForHelper, publicProfiles } from "@/lib/deals/queries";
import { errandSplit } from "@/lib/engine";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { CATEGORY_ICON } from "@/lib/labels";
import { fuzz, googleDirectionsUrl } from "@/lib/maps";
import { jobAction } from "../actions";

/**
 * The helper's view of one task (docs/screens-helper-ops.md): what it pays, how far, and the
 * one next action — accept / send a price → wait for payment → start → (proof, next update).
 * Exact entrance/floor/door stay hidden until the helper is matched.
 */
export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const { id } = await params;
  const [deal, t, locale] = await Promise.all([getJobForHelper(id, viewer), getT(), getLocale()]);
  if (!deal) notFound();
  const me = viewer.profile.id;
  const mine = deal.helperId === me;
  const myOffer = deal.offers.find((o) => o.helperId === me);
  const customer = (await publicProfiles([deal.customerId])).get(deal.customerId);
  const now = Date.now();
  const net = errandSplit({ fee: deal.fee, itemBudget: 0, receipt: null, serviceFee: deal.serviceFee, commissionBps: deal.commissionBps }).helperFeeNet;
  const fields = { dealId: deal.id };
  const dt = deal.details;
  const bits = mine
    ? [
        dt.entrance && t("details.entrance", { v: dt.entrance }),
        dt.floor !== null && t("details.floor", { v: dt.floor }),
        dt.unit && t("details.unit", { v: dt.unit }),
        dt.lift === "yes" ? t("details.liftYes") : dt.lift === "no" ? t("details.liftNo") : null,
        dt.people === 2 && t("details.people", { n: 2 }),
      ].filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  let primary: React.ReactNode = null;
  const secondary: React.ReactNode[] = [];
  let line: React.ReactNode = null;

  const canTake = viewer.actor.helperApproved && (viewer.actor.categories ?? []).includes(deal.category);
  if (deal.status === "open" && !myOffer && !canTake) {
    line = viewer.actor.helperApproved
      ? t("job.needCategory", { category: t(`categoryShort.${deal.category}`) })
      : t("job.needApproval");
  } else if (deal.status === "open" && !myOffer) {
    if (deal.mode === "now") {
      primary = (
        <InlineAction
          action={jobAction}
          fields={{ ...fields, intent: "apply" }}
          label={t("job.apply", { amount: fmtMoney(net) })}
          className={`${btn.primary} w-full`}
          done={<Note tone="info">{t("job.applied")}</Note>}
        >
          <label className={fieldLabel}>
            {t("job.applyNote")}
            <input name="note" maxLength={300} className={field} placeholder={t("job.applyNotePh")} />
          </label>
        </InlineAction>
      );
    } else {
      primary = (
        <InlineAction
          action={jobAction}
          fields={{ ...fields, intent: "quote" }}
          label={t("job.quote")}
          className={`${btn.primary} w-full`}
          done={<Note tone="info">{t("job.quoteDone")}</Note>}
        >
          <label className={fieldLabel}>
            {t("job.quotePrice")}
            <input name="price" inputMode="numeric" defaultValue={String(deal.postedFee)} className={`${field} text-[20px] font-bold tabular-nums`} required />
          </label>
          <label className={fieldLabel}>
            {t("job.quoteNote")}
            <input name="note" maxLength={300} className={field} />
          </label>
        </InlineAction>
      );
    }
    secondary.push(<InlineAction key="skip" action={jobAction} fields={{ ...fields, intent: "skip" }} label={t("job.skip")} className={btn.text} />);
  } else if (deal.status === "open" && myOffer) {
    line = myOffer.price !== null ? t("job.quoteSent", { amount: fmtMoney(myOffer.price) }) : t("job.applied");
    secondary.push(
      <InlineAction key="unapply" action={jobAction} fields={{ ...fields, intent: "unapply" }} label={t("job.unapply")} className={btn.text} />,
    );
  } else if (mine && deal.status === "awaiting_payment") {
    line = deal.payBy ? <Countdown until={deal.payBy} serverNow={now} template={t("job.waitingPay")} /> : null;
    secondary.push(
      <ConfirmSheet
        key="withdraw"
        action={jobAction}
        fields={{ ...fields, intent: "withdraw" }}
        trigger={t("job.withdraw")}
        triggerClass={btn.text}
        title={t("job.withdrawTitle")}
        body={t("job.withdrawBody")}
        confirmLabel={t("job.withdraw")}
        confirmClass={btn.danger}
      />,
    );
  } else if (mine && deal.status === "matched") {
    line = t("job.paidGo");
    primary = <InlineAction action={jobAction} fields={{ ...fields, intent: "start" }} label={t("job.start")} className={`${btn.primary} w-full`} />;
  } else if (mine && deal.status === "in_progress") {
    line = t("job.inProgress");
  }
  if (mine && (deal.status === "matched" || deal.status === "in_progress")) {
    secondary.push(
      <ConfirmSheet
        key="cancel"
        action={jobAction}
        fields={{ ...fields, intent: "withdraw" }}
        trigger={t("job.cancelLate")}
        triggerClass={btn.textDanger}
        title={t("job.cancelLateTitle")}
        body={t("job.cancelLateBody")}
        confirmLabel={t("job.cancelLate")}
        confirmClass={btn.danger}
      />,
    );
  }

  // Exact pin only for the matched helper; everyone else sees a ~300 m area (privacy).
  const onJob = mine && (deal.status === "matched" || deal.status === "in_progress");
  const exact = mine && deal.status !== "open";
  const markers: MapMarker[] = deal.location
    ? [exact ? { ...deal.location, kind: "task", label: deal.address } : { ...fuzz(deal.location), kind: "area" }]
    : [];
  const directions = googleDirectionsUrl(deal.location ?? deal.address, deal.pickupAddress);

  return (
    <>
      <FlowHeader href="/jobs" label={t("common.back")} />
      {onJob && <JobBeacon dealId={deal.id} />}
      {(deal.status === "open" || deal.status === "awaiting_payment") && <AutoRefresh seconds={10} />}

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink-2">
              <span aria-hidden>{CATEGORY_ICON[deal.category]}</span> {t(`category.${deal.category}`)} ·{" "}
              {deal.scheduledAt ? fmtDateTime(deal.scheduledAt, locale) : t("deal.now")}
            </p>
            <h1 className="mt-0.5 text-xl font-bold leading-snug">{deal.title}</h1>
          </div>
          <StatusBadge status={deal.status} t={t} />
        </div>
        <p className="text-[28px] font-bold tabular-nums">{t("job.youEarn", { amount: fmtMoney(net) })}</p>
        {deal.itemBudget > 0 && <p className="text-[15px] text-ink-2">{t("job.plusItems", { amount: fmtMoney(deal.itemBudget) })}</p>}
        {line && <p className="text-[16px]">{line}</p>}
        {mine && deal.heldAmount > 0 && <HeldBadge>{t("money.heldBadge", { amount: fmtMoney(deal.heldAmount) })}</HeldBadge>}
      </Card>

      {markers.length > 0 && <TaskMap markers={markers} showMe className="h-56" />}
      {exact ? (
        <a href={directions} target="_blank" rel="noopener noreferrer" className={`${btn.secondary} w-full`}>
          🧭 {t("map.directions")}
        </a>
      ) : (
        deal.location && <p className="-mt-2 text-sm text-ink-2">{t("map.approx")}</p>
      )}

      <Card>
        <p className="whitespace-pre-line text-[16px]">{deal.description}</p>
        {deal.pickupAddress && <p className="text-[15px] text-ink-2">● {t("deal.pickupAt", { place: deal.pickupAddress })}</p>}
        {exact && <p className="text-[15px] text-ink-2">↘ {deal.address}</p>}
        {bits.length > 0 && <p className="text-[15px] text-ink-2">{bits.join(" · ")}</p>}
        {mine && dt.note && <p className="rounded-input bg-fill p-2.5 text-[15px]">{dt.note}</p>}
        {!mine && <p className="text-sm text-ink-2">{t("job.addressAfterMatch")}</p>}
        {customer && (
          <p className="text-sm text-ink-2">
            {customer.name}
            {customer.rating !== null ? ` · ★ ${Number(customer.rating).toFixed(1)}` : ""}
          </p>
        )}
      </Card>

      {(primary || secondary.length > 0) && (
        <PrimaryBar>
          {primary}
          {secondary.length > 0 && <div className="flex flex-wrap justify-center gap-1">{secondary}</div>}
        </PrimaryBar>
      )}
    </>
  );
}
