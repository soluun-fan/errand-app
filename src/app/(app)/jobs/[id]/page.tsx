import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Countdown } from "@/components/countdown";
import { InlineAction } from "@/components/inline-action";
import { JobBeacon } from "@/components/job-beacon";
import { ProofGallery } from "@/components/proof-gallery";
import { ProofUploader } from "@/components/proof-uploader";
import { TaskMap, type MapMarker } from "@/components/task-map";
import { ConfirmSheet } from "@/components/sheet";
import { AddressBox, DetailPair, DetailSection, DetailTitle, MapHero } from "@/components/detail";
import { StatusBadge } from "@/components/status-badge";
import { FlowHeader, HeldBadge, Note, PrimaryBar, btn, field, fieldLabel } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getJobForHelper, publicProfiles } from "@/lib/deals/queries";
import { counterMaxFor, errandSplit } from "@/lib/engine";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { CATEGORY_ICON } from "@/lib/labels";
import { fuzz, googleDirectionsUrl } from "@/lib/maps";
import { accessFor, unreadCount } from "@/lib/chat";
import { callParty } from "@/lib/calls";
import { proofsFor } from "@/lib/proofs";
import { SafetyBar } from "@/components/safety-bar";
import { SOS_STATUSES } from "@/lib/incident-rules";
import { liveSos } from "@/lib/incidents";
import { ContactRow } from "../../tasks/[id]/deal-view";
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

  // What the price was built from, so helpers can judge it (time, heavy, tools, people)
  const duration = dt.minutes >= 60 ? t("price.hours", { n: dt.minutes / 60 }) : t("price.min", { n: dt.minutes });
  const when = deal.scheduledAt
    ? t("job.startsAt", { time: fmtDateTime(deal.scheduledAt, locale), dur: duration })
    : t("job.nowFor", { dur: duration });
  const effort = [
    dt.km > 0 && t("job.trip", { km: dt.km.toFixed(1) }),
    dt.heavy && t("task.heavy"),
    dt.tools && t("price.tools"),
    dt.people === 2 && t("details.people", { n: 2 }),
  ].filter((x): x is string => typeof x === "string" && x.length > 0);

  let primary: React.ReactNode = null;
  const secondary: React.ReactNode[] = [];
  let line: React.ReactNode = null;

  const canTake = viewer.actor.helperApproved && (viewer.actor.categories ?? []).includes(deal.category);
  if (deal.status === "open" && !myOffer && !canTake) {
    line = viewer.actor.helperApproved
      ? t("job.needCategory", { category: t(`categoryShort.${deal.category}`) })
      : t("job.needApproval");
  } else if (deal.status === "open" && !myOffer) {
    // Accept the customer's price, or counter once — higher, up to the cap (docs/decisions.md "Pricing").
    const cap = deal.details.counterMax > 0 ? deal.details.counterMax : counterMaxFor(deal.postedFee);
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
    if (cap > deal.postedFee) {
      secondary.push(
        <ConfirmSheet
          key="counter"
          action={jobAction}
          fields={{ ...fields, intent: "quote" }}
          trigger={t("price.counter")}
          triggerClass={btn.text}
          title={t("price.counterTitle")}
          body={t("price.counterBody", { amount: fmtMoney(deal.postedFee), max: fmtMoney(cap) })}
          confirmLabel={t("price.counterSend")}
        >
          <label className={fieldLabel}>
            {t("job.quotePrice")}
            <input
              name="price"
              inputMode="numeric"
              defaultValue={String(Math.min(cap, deal.postedFee + 1000))}
              className={`${field} text-[20px] font-bold tabular-nums`}
              required
            />
          </label>
          <label className={fieldLabel}>
            {t("price.counterWhy")}
            <input name="note" maxLength={300} className={field} placeholder={t("price.counterWhyPh")} />
          </label>
        </ConfirmSheet>,
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
    const needReceipt = deal.itemBudget > 0 && deal.receiptAmount === null && deal.topUp?.status !== "declined";
    const ready = deal.handoverProofAt !== null && !needReceipt && deal.topUp?.status !== "pending";
    if (ready) {
      primary = (
        <InlineAction action={jobAction} fields={{ ...fields, intent: "finish" }} label={`✓ ${t("proof.finish")}`} className={`${btn.primary} w-full`} />
      );
      line = t("proof.finishSub", { hours: deal.checkHours });
    }
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
  const pickupLabel = deal.pickupAddress ?? t("map.pickup");
  const markers: MapMarker[] = [
    ...(deal.pickupLocation
      ? [exact ? { ...deal.pickupLocation, kind: "pickup" as const, label: pickupLabel } : { ...fuzz(deal.pickupLocation), kind: "pickupArea" as const }]
      : []),
    ...(deal.location ? [exact ? { ...deal.location, kind: "task" as const, label: deal.address } : { ...fuzz(deal.location), kind: "area" as const }] : []),
  ];
  // the pickup pin beats its text for the Google Maps waypoint
  const directions = googleDirectionsUrl(deal.location ?? deal.address, deal.pickupLocation ?? deal.pickupAddress);

  const proofs = mine && deal.status !== "open" && deal.status !== "awaiting_payment" ? await proofsFor(deal.id) : [];
  const chatAccess = await accessFor(deal, me);
  const unread = chatAccess.canRead && chatAccess.threadHelperId ? await unreadCount(deal.id, chatAccess.threadHelperId, me) : null;
  const sos = mine ? await liveSos(deal.id, me) : null;

  const pickupDirections = deal.pickupLocation || deal.pickupAddress ? googleDirectionsUrl(deal.pickupLocation ?? (deal.pickupAddress as string)) : undefined;

  return (
    <>
      <FlowHeader href="/jobs" label={t("common.back")} />
      {onJob && <JobBeacon dealId={deal.id} />}
      {(deal.status === "open" || deal.status === "awaiting_payment") && <AutoRefresh seconds={10} />}

      {markers.length > 0 && (
        <MapHero caption={exact ? undefined : t("map.approx")}>
          <TaskMap
            markers={markers}
            showMe
            rounded={false}
            route={markers}
            routeFromMe={deal.status === "open" || deal.status === "awaiting_payment" || onJob}
            className="h-[34vh] min-h-56"
          />
        </MapHero>
      )}

      <DetailTitle
        tag={
          <>
            <span aria-hidden>{CATEGORY_ICON[deal.category]}</span> {t(`categoryShort.${deal.category}`)}
          </>
        }
        status={<StatusBadge status={deal.status} t={t} />}
        title={deal.title}
      >
        {line && <p className="text-[16px]">{line}</p>}
        {mine && deal.heldAmount > 0 && <HeldBadge>{t("money.heldBadge", { amount: fmtMoney(deal.heldAmount) })}</HeldBadge>}
      </DetailTitle>

      {unread !== null && <ContactRow dealId={deal.id} unread={unread} canCall={callParty(deal, me) !== null} t={t} />}
      {mine && <SafetyBar dealId={deal.id} showSos={(SOS_STATUSES as readonly string[]).includes(deal.status)} live={sos} />}

      {/* what it pays | what to buy — "no purchase" is said, not implied */}
      <DetailPair
        left={{ label: t("job.feeLabel"), value: <span className="text-[24px] font-bold tabular-nums leading-tight text-brand-ink">{fmtMoney(net)}</span> }}
        right={{
          label: t("job.itemsLabel"),
          value:
            deal.itemBudget > 0 ? (
              <>
                <span className="block text-[18px] font-bold tabular-nums">{t("job.itemsUpTo", { amount: fmtMoney(deal.itemBudget) })}</span>
                <span className="block text-sm text-ink-2">{t("job.itemsHow")}</span>
              </>
            ) : (
              <span className="text-[18px] font-bold">{t("job.noItems")}</span>
            ),
        }}
      />

      <DetailSection label={t("job.whenLabel")}>
        <p className="text-[18px] font-bold">{when}</p>
        {effort.length > 0 && <p className="text-[15px] text-ink-2">{effort.join(" · ")}</p>}
      </DetailSection>

      <DetailSection label={t("job.placeLabel")}>
        <p className="whitespace-pre-line pb-1 text-[16px]">{deal.description}</p>
        <div className="flex flex-col gap-2">
          {deal.pickupAddress && (
            <AddressBox
              icon="●"
              label={t("task.pickup")}
              address={deal.pickupAddress}
              directionsUrl={exact ? pickupDirections : undefined}
              directionsLabel={t("map.directionsShort")}
            />
          )}
          <AddressBox
            icon="↘"
            label={deal.pickupAddress || deal.pickupLocation ? t("task.drop") : t("task.where")}
            address={exact ? deal.address : null}
            hidden={t("job.addressAfterMatch")}
            directionsUrl={directions}
            directionsLabel={t("map.directionsShort")}
          />
        </div>
        {bits.length > 0 && <p className="text-[15px] text-ink-2">{bits.join(" · ")}</p>}
        {mine && dt.note && <p className="rounded-input bg-fill p-3 text-[15px]">{dt.note}</p>}
      </DetailSection>

      {mine && deal.status === "in_progress" && (
        <DetailSection label={t("proof.title")}>
          <div className="flex flex-col gap-3">
            {deal.itemBudget > 0 && deal.topUp?.status !== "declined" && (
              <ProofUploader dealId={deal.id} kind="receipt" done={deal.receiptAmount !== null} />
            )}
            {deal.topUp?.status === "pending" && <Note tone="warn">{t("proof.waitTopUp")}</Note>}
            <ProofUploader dealId={deal.id} kind="handover" done={deal.handoverProofAt !== null} />
          </div>
        </DetailSection>
      )}
      {proofs.length > 0 && <ProofGallery proofs={proofs} t={t} showFlags={false} />}

      {customer && (
        <DetailSection label={t("job.customerLabel")}>
          <p className="text-[16px]">
            {customer.name}
            {customer.rating !== null ? ` · ★ ${Number(customer.rating).toFixed(1)}` : ""}
          </p>
        </DetailSection>
      )}

      {(primary || secondary.length > 0) && (
        <PrimaryBar>
          {primary}
          {secondary.length > 0 && <div className="flex flex-wrap justify-center gap-1">{secondary}</div>}
        </PrimaryBar>
      )}
    </>
  );
}
