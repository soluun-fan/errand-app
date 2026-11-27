import { notFound } from "next/navigation";
import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import { AutoRefresh } from "@/components/auto-refresh";
import { Countdown } from "@/components/countdown";
import { InlineAction } from "@/components/inline-action";
import { createAdminClient } from "@/lib/supabase/admin";
import { JobBeacon } from "@/components/job-beacon";
import { ProofGallery } from "@/components/proof-gallery";
import { ProofUploader } from "@/components/proof-uploader";
import { CareCheckOut } from "@/components/care-check-out";
import { TaskMap, type MapMarker } from "@/components/task-map";
import { ConfirmSheet } from "@/components/sheet";
import { AddressBox, DetailRows, DetailSection, DetailTitle, MapHero, RouteStops } from "@/components/detail";
import { StatusBadge } from "@/components/status-badge";
import { FlowHeader, HeldBadge, Note, PrimaryBar, btn, field, fieldLabel } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getJobForHelper, publicProfiles, timeline } from "@/lib/deals/queries";
import { arriveBy, categoryConfig, categoryTrust, errandSplit, helperLate, invitedOnly, missingConditions, ruleOf } from "@/lib/engine";
import { ConditionChips } from "@/components/conditions";
import { getRules } from "@/lib/rules";
import { directPayOpen, directPayState, owedToHelper } from "@/lib/direct-pay";
import { DirectPayHelperCard } from "@/components/direct-pay-card";
import { pauseDaysFor, recentBackOuts } from "@/lib/penalties";
import { fmtClock, fmtDateTime, fmtMoney } from "@/lib/format";
import { fuzz, googleDirectionsUrl, helperStart } from "@/lib/maps";
import { accessFor, unreadCount } from "@/lib/chat";
import { callParty, callsEnabled } from "@/lib/calls";
import { proofsFor } from "@/lib/proofs";
import { portfolioCandidates } from "@/lib/work-photos";
import { WorkReady } from "@/components/work-ready";
import { computerAllowed, computerPositionFresh, deviceCheckBypassed } from "@/lib/work-ready";
import { PortfolioAskSection } from "@/components/portfolio-cards";
import { taskPhotosFor } from "@/lib/task-photos";
import { workedTogether } from "@/lib/care";
import { TaskPhotoGrid } from "@/components/task-photo-grid";
import { SafetyBar } from "@/components/safety-bar";
import { PriceChangeCard } from "@/components/price-change-card";
import { SOS_STATUSES } from "@/lib/incident-rules";
import { CUSTOMER_TAGS } from "@/lib/labels";
import { liveSos } from "@/lib/incidents";
import { organizationNames } from "@/lib/orgs";
import { ContactRow } from "../../tasks/[id]/deal-view";
import { jobAction, removeMyProof } from "../actions";
import { Hash } from "lucide-react";
import { JobOutcome, type ReleasedHow } from "@/components/job-outcome";
import { Ico } from "@/components/icon";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("meta.job");

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
  if (deal.status === "open" && categoryTrust(deal.category) === "care") {
    const hasApplication = deal.offers.some((offer) => offer.helperId === viewer.profile.id);
    return (
      <>
        <Note tone="info">{t("care.launchScope")}</Note>
        {hasApplication && (
          <InlineAction action={jobAction} fields={{ dealId: deal.id, intent: "unapply" }} label={t("job.unapply")} className={btn.text} />
        )}
      </>
    );
  }
  const me = viewer.profile.id;
  const mine = deal.helperId === me;
  const myOffer = deal.offers.find((o) => o.helperId === me);
  const customer = (await publicProfiles([deal.customerId])).get(deal.customerId);
  // what helpers said about this customer (kept apart from helper ratings), and whether I rated them
  const [{ data: custStats }, { data: myRating }] = await Promise.all([
    createAdminClient()
      .from("profiles")
      .select("customer_rating_sum, customer_rating_count, kyc_level")
      .eq("id", deal.customerId)
      .maybeSingle<{ customer_rating_sum: number; customer_rating_count: number; kyc_level: number }>(),
    createAdminClient()
      .from("ratings")
      .select("stars")
      .eq("deal_id", deal.id)
      .eq("from_user_id", viewer.profile.id)
      .maybeSingle<{ stars: number }>(),
  ]);
  const customerRating =
    custStats && custStats.customer_rating_count > 0 ? custStats.customer_rating_sum / custStats.customer_rating_count : null;
  const now = Date.now();
  // while bargaining, the price on the table between this helper and the customer
  const onTable = deal.status === "open" && myOffer?.price != null ? myOffer.price : deal.fee;
  const net = errandSplit({
    fee: onTable,
    itemBudget: 0,
    receipt: null,
    serviceFee: deal.serviceFee,
    commissionBps: deal.commissionBps,
  }).helperFeeNet;
  const fields = { dealId: deal.id };
  // the helper's own finished job: what they get (fee + items repaid), and how it was approved
  const outcome =
    mine && (deal.status === "check" || deal.status === "released" || deal.status === "disputed")
      ? await (async () => {
          const released = deal.status === "released" ? (await timeline(deal.id)).findLast((e) => e.code === "released") : undefined;
          const how = released?.data.how;
          return {
            status: deal.status as "check" | "released" | "disputed",
            amount: errandSplit({ fee: deal.fee, itemBudget: deal.itemBudget, receipt: deal.receiptAmount, serviceFee: deal.serviceFee, commissionBps: deal.commissionBps }).helperNet,
            how: (how === "confirmed" || how === "auto" || how === "ops" ? how : null) as ReleasedHow,
            releasedAt: released ? released.at : null,
          };
        })()
      : null;
  const proofs = mine && deal.status !== "open" && deal.status !== "awaiting_payment" ? await proofsFor(deal.id) : [];
  /** a handover photo (or care check-out) by this helper that is still there */
  const handoverLive = proofs.some((p) => p.kind === "handover" && p.uploadedBy === me);
  // no start or progress photos on care work (never photograph the child or the person cared for)
  const startPhoto = categoryTrust(deal.category) !== "care";
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
    : deal.mode === "schedule" && deal.matchBy
      ? t("job.flexibleFor", { time: fmtDateTime(deal.matchBy, locale), dur: duration }) // not urgent: open until then
      : t("job.nowFor", { dur: duration });
  const effort = [
    dt.contactless && t("job.contactless"),
    dt.parking === "yes" ? t("details.parkingYes") : dt.parking === "no" ? t("details.parkingNo") : null,
    dt.km > 0 && t("job.trip", { km: dt.km.toFixed(1) }),
    dt.heavy && t("task.heavy"),
    dt.tools && t("price.tools"),
    dt.people === 2 && t("details.people", { n: 2 }),
  ].filter((x): x is string => typeof x === "string" && x.length > 0);

  /** "Name a different price" sheet: any amount at or above the minimum; the customer can answer. */
  const priceSheet = (intent: "quote" | "reprice", start: number) => (
    <ConfirmSheet
      key={intent}
      action={jobAction}
      fields={{ ...fields, intent }}
      trigger={t("price.counter")}
      triggerClass={btn.text}
      title={t("price.counterTitle")}
      body={t("price.counterBodyOpen", { amount: fmtMoney(deal.postedFee) })}
      confirmLabel={t("price.counterSend")}
    >
      <label className={fieldLabel}>
        {t("job.quotePrice")}
        <input
          name="price"
          inputMode="numeric"
          defaultValue={String(start)}
          className={`${field} text-title-lg font-bold tabular-nums`}
          required
        />
      </label>
      {intent === "quote" && (
        <label className={fieldLabel}>
          {t("price.counterWhy")}
          <input name="note" maxLength={300} className={field} placeholder={t("price.counterWhyPh")} />
        </label>
      )}
    </ConfirmSheet>
  );

  let primary: React.ReactNode = null;
  const secondary: React.ReactNode[] = [];
  let line: React.ReactNode = null;

  const specialized = categoryTrust(deal.category) !== "open";
  const qualification = viewer.actor.qualified?.find((q) => q.category === deal.category);
  const payeeOrgId = deal.helperId ? deal.payeeOrgId : myOffer ? myOffer.orgId : (qualification?.orgId ?? null);
  const payee = payeeOrgId ? (await organizationNames([payeeOrgId])).get(payeeOrgId) : undefined;
  const canTake =
    viewer.actor.helperApproved && (specialized ? Boolean(qualification) : (viewer.actor.categories ?? []).includes(deal.category));
  // the customer's conditions this helper doesn't meet (docs/decisions.md 2026-11-18 "Task conditions")
  const missing = deal.status === "open" && viewer.actor.helperApproved ? missingConditions(deal.details.require, viewer.actor.badges) : [];
  const gateActions =
    viewer.actor.helperApproved && ((deal.status === "open" && canTake && missing.length === 0) || (mine && deal.status === "matched"));
  // Sent straight to this helper from their profile (docs/decisions.md 2026-11-16 "Direct requests")
  const invitedMe = deal.status === "open" && invitedOnly(deal, now) === me;
  const declineSheet = invitedMe && deal.invite && (
    <ConfirmSheet
      key="decline"
      action={jobAction}
      fields={{ ...fields, intent: "decline_invite" }}
      trigger={t("invite.decline")}
      triggerClass={btn.text}
      title={t("invite.declineTitle")}
      body={deal.invite.openAfter ? t("invite.declineOpenBody") : t("invite.declineEndBody")}
      confirmLabel={t("invite.declineConfirm")}
    />
  );
  if (deal.status === "open" && !myOffer && canTake && missing.length > 0) {
    line = t("conditions.youMiss");
    primary = (
      <Link
        href={missing.includes("language") && missing.length === 1 ? "/profile" : "/helper/badges"}
        className={`${btn.secondary} w-full`}
      >
        {t("conditions.getThem")}
      </Link>
    );
  } else if (deal.status === "open" && !myOffer && !canTake) {
    line = viewer.actor.helperApproved
      ? specialized
        ? t("specialized.qualified")
        : t("job.needCategory", { category: t(`categoryShort.${deal.category}`) })
      : t("job.needApproval");
    // every "you need…" has the page to do it
    if (!viewer.actor.helperApproved) {
      primary = (
        <Link href="/helper/apply" className={`${btn.primary} w-full`}>
          {t("job.needApprovalGo")}
        </Link>
      );
    } else if (specialized) {
      primary = (
        <Link href="/helper/certificates" className={`${btn.primary} w-full`}>
          {t("job.needCertGo")}
        </Link>
      );
    }
    // an everyday kind they just haven't picked yet: add it and apply in one tap
    if (viewer.actor.helperApproved && !specialized && !invitedOnly(deal, now)) {
      primary = (
        <InlineAction
          action={jobAction}
          fields={{ ...fields, intent: "add_kind_apply" }}
          label={t("job.addKindApply", { category: t(`categoryShort.${deal.category}`), amount: fmtMoney(net) })}
          className={`${btn.primary} w-full`}
          done={<Note tone="info">{t("job.applied")}</Note>}
        />
      );
    }
  } else if (deal.status === "open" && !myOffer) {
    // Take the customer's price, or name your own — bargaining is open (docs/decisions.md 2026-11-16).
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
    secondary.push(priceSheet("quote", deal.postedFee));
    secondary.push(
      declineSheet || (
        <InlineAction key="skip" action={jobAction} fields={{ ...fields, intent: "skip" }} label={t("job.skip")} className={btn.text} />
      ),
    );
  } else if (deal.status === "open" && myOffer) {
    if (myOffer.proposedBy === "customer" && myOffer.price !== null) {
      // the customer answered with their price: take it (→ matched) or answer with another
      line = t("price.customerOffers", { amount: fmtMoney(myOffer.price) });
      primary = (
        <InlineAction
          action={jobAction}
          fields={{ ...fields, intent: "accept_counter" }}
          label={t("price.acceptAt", { amount: fmtMoney(myOffer.price) })}
          className={`${btn.primary} w-full`}
        />
      );
    } else {
      line = myOffer.price !== null ? t("job.quoteSent", { amount: fmtMoney(myOffer.price) }) : t("job.applied");
    }
    secondary.push(priceSheet("reprice", myOffer.price ?? deal.postedFee));
    secondary.push(
      declineSheet || (
        <InlineAction
          key="unapply"
          action={jobAction}
          fields={{ ...fields, intent: "unapply" }}
          label={t("job.unapply")}
          className={btn.text}
        />
      ),
    );
  } else if (mine && deal.status === "awaiting_payment") {
    line = deal.payBy ? <Countdown until={deal.payBy} serverNow={now} template={t("job.waitingPay")} /> : null;
  } else if (mine && deal.status === "matched") {
    line = deal.payMode === "direct" ? t("direct.helper.paidGo") : t("job.paidGo");
    // the start photo starts the job (it's below); care work starts with the plain button, no photo
    primary = startPhoto ? (
      <ProofUploader dealId={deal.id} kind="start" done={false} compact />
    ) : (
      <InlineAction action={jobAction} fields={{ ...fields, intent: "start" }} label={t("job.start")} className={`${btn.primary} w-full`} />
    );
  } else if (mine && deal.status === "in_progress") {
    const needReceipt = deal.itemBudget > 0 && deal.receiptAmount === null && deal.topUp?.status !== "declined";
    const ready = handoverLive && !needReceipt && deal.topUp?.status !== "pending";
    if (ready) {
      primary = (
        <InlineAction
          action={jobAction}
          fields={{ ...fields, intent: "finish" }}
          label={t("proof.finishSlide")}
          className={`${btn.primary} w-full`}
          slide
        >
          {deal.details.require?.handoverCode && (
            <label className={fieldLabel}>
              <Ico as={Hash} /> {t("conditions.codeAsk")}
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                required
                autoComplete="off"
                className={`${field} text-center text-headline font-bold tracking-[0.3em] tabular-nums`}
              />
            </label>
          )}
        </InlineAction>
      );
      line = t("proof.finishSub", { hours: deal.checkHours });
    }
  }
  if (mine && (deal.status === "awaiting_payment" || deal.status === "matched" || deal.status === "in_progress")) {
    // Backing out (docs/decisions.md 2026-11-17): free within 10 minutes of being chosen, then an
    // escalating pause; either way the task is posted anew and the customer is refunded.
    const late = deal.assignedAt === null || now - deal.assignedAt > ruleOf(deal, "backOutGraceMinutes") * 60_000;
    const days = late ? pauseDaysFor((await recentBackOuts(me, now)) + 1, categoryTrust(deal.category) === "care", await getRules()) : 0;
    secondary.push(
      <ConfirmSheet
        key="cancel"
        action={jobAction}
        fields={{ ...fields, intent: "withdraw" }}
        trigger={t("job.cancelLate")}
        triggerClass={late ? btn.textDanger : btn.text}
        title={t("job.cancelLateTitle")}
        body={
          late
            ? t("job.cancelLateBody", {
                days: days === 1 ? t("job.pauseDay") : t("job.pauseDays", { n: days }),
                minutes: ruleOf(deal, "backOutGraceMinutes"),
              })
            : t("job.cancelFreeBody", { minutes: ruleOf(deal, "backOutGraceMinutes") })
        }
        confirmLabel={t("job.cancelLate")}
        confirmClass={btn.danger}
      />,
    );
  }

  // Exact pin only for the matched helper; everyone else sees a ~300 m area (privacy).
  const onJob = mine && (deal.status === "matched" || deal.status === "in_progress");
  const exact = mine && deal.status !== "open" && deal.status !== "awaiting_payment";
  const working = mine && deal.status === "in_progress";
  const pickupLabel = deal.pickupAddress ?? t("map.pickup");
  const markers: MapMarker[] = [
    ...(deal.pickupLocation
      ? [
          exact
            ? { ...deal.pickupLocation, kind: "pickup" as const, label: pickupLabel }
            : { ...fuzz(deal.pickupLocation), kind: "pickupArea" as const },
        ]
      : []),
    ...(deal.location
      ? [exact ? { ...deal.location, kind: "task" as const, label: deal.address } : { ...fuzz(deal.location), kind: "area" as const }]
      : []),
  ];
  // the pickup pin beats its text for the Google Maps waypoint
  const directions = googleDirectionsUrl(deal.location ?? deal.address, deal.pickupLocation ?? deal.pickupAddress);

  const photos = await taskPhotosFor(deal.id);
  const firstMeeting = !startPhoto && mine && !(await workedTogether(deal.customerId, [me])).has(me);
  const chatAccess = await accessFor(deal, viewer);
  const unread = chatAccess.canRead && chatAccess.threadHelperId ? await unreadCount(deal.id, chatAccess.threadHelperId, me) : null;
  const sos = mine ? await liveSos(deal.id, me) : null;

  const pickupDirections =
    deal.pickupLocation || deal.pickupAddress ? googleDirectionsUrl(deal.pickupLocation ?? (deal.pickupAddress as string)) : undefined;

  return (
    <>
      {markers.length === 0 && <FlowHeader href="/jobs" label={t("common.back")} />}
      {working && <JobBeacon key={deal.id} dealId={deal.id} />}
      {mine && deal.status === "matched" && arriveBy(deal) !== null && (
        <div className="mx-auto w-full max-w-2xl px-5 pt-3">
          <Note tone={helperLate(deal, now) ? "bad" : "info"}>
            <span className="font-semibold">{t("standards.arriveBy", { time: fmtClock(arriveBy(deal) as number) })}</span>{" "}
            {helperLate(deal, now) ? t("standards.youAreLate") : deal.enRouteAt ? t("noShow.enRouteNote") : t("standards.arriveHint")}
          </Note>
          {/* "On my way" shares the helper's location from now; "Need more time?" for traffic (2026-11-24) */}
          {!helperLate(deal, now) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {!deal.enRouteAt && (
                <InlineAction
                  action={jobAction}
                  fields={{ dealId: deal.id, intent: "on_my_way" }}
                  label={t("noShow.onMyWay")}
                  className={btn.small}
                />
              )}
              {[15, 30]
                .filter((m) => (deal.arriveExtendMinutes ?? 0) + m <= ruleOf(deal, "maxDelayMinutes"))
                .map((m) => (
                  <ConfirmSheet
                    key={m}
                    action={jobAction}
                    fields={{ dealId: deal.id, intent: "need_time", minutes: String(m) }}
                    trigger={t("noShow.needTime", { n: m })}
                    triggerClass={btn.secondary}
                    title={t("noShow.needTimeTitle", { n: m })}
                    body={t("noShow.needTimeBody", { time: fmtClock((arriveBy(deal) as number) + m * 60_000) })}
                    confirmLabel={t("noShow.needTimeGo")}
                  />
                ))}
            </div>
          )}
        </div>
      )}
      {mine && deal.status === "in_progress" && deal.location && (
        <div className="mx-auto w-full max-w-2xl px-5 pt-3">
          {deal.absentAt ? (
            <Note tone="warn">{t("noShow.waiting", { time: fmtClock(deal.absentAt + ruleOf(deal, "absentGraceMinutes") * 60_000) })}</Note>
          ) : (
            <ConfirmSheet
              action={jobAction}
              fields={{ dealId: deal.id, intent: "customer_absent" }}
              trigger={t("noShow.report")}
              triggerClass={btn.text}
              title={t("noShow.reportTitle")}
              body={t("noShow.reportBody", { minutes: ruleOf(deal, "absentGraceMinutes"), fee: fmtMoney(deal.cancelFee) })}
              confirmLabel={t("noShow.reportGo")}
            />
          )}
        </div>
      )}
      {["open", "awaiting_payment", "matched", "in_progress"].includes(deal.status) && <AutoRefresh seconds={10} />}

      {markers.length > 0 && (
        <MapHero caption={exact ? undefined : t("map.approx")} backHref="/jobs" backLabel={t("common.back")}>
          <TaskMap
            markers={markers}
            showMe
            rounded={false}
            route={markers}
            routeFromMe={deal.status === "open" || deal.status === "awaiting_payment" || onJob}
            className="h-[44vh] min-h-64"
            // tap the map: Google Maps with the route (approximate area until the helper is matched)
            openUrl={
              exact
                ? directions
                : helperStart(deal)
                  ? googleDirectionsUrl(fuzz(helperStart(deal) as { lat: number; lng: number }))
                  : undefined
            }
          />
        </MapHero>
      )}

      {/* finished, checking, approved — impossible to miss (2026-11-27) */}
      {outcome && (
        <div className="mx-auto w-full max-w-2xl">
          <JobOutcome
            status={outcome.status}
            checkUntil={deal.checkUntil}
            serverNow={now}
            amount={outcome.amount}
            how={outcome.how}
            releasedAt={outcome.releasedAt}
            t={t}
            locale={locale}
          />
        </div>
      )}
      <DetailTitle
        tag={
          <>
            <CategoryIcon id={deal.category} size={16} /> {t(`categoryShort.${deal.category}`)}
          </>
        }
        status={<StatusBadge status={deal.status} t={t} helper />}
        title={deal.title}
        overlap={markers.length > 0}
      >
        {invitedMe && deal.invite && (
          <Note tone="info">
            {t("invite.toYou", { name: customer?.name ?? t("deal.customer") })}{" "}
            {deal.invite.openAfter ? (
              <Countdown until={deal.invite.until} serverNow={now} template={t("invite.toYouUntil")} />
            ) : (
              t("invite.toYouOnly")
            )}
          </Note>
        )}
        {deal.status === "open" && categoryTrust(deal.category) === "care" && <Note tone="warn">{t("care.helperNote")}</Note>}
        {!startPhoto && <Note tone="info">{t(deal.category === "eldercare" ? "care.scopeElder" : "care.scopeChild")}</Note>}
        {!startPhoto && mine && firstMeeting && <Note tone="info">{t("care.meetFirstHelper")}</Note>}
        {line && <p className="text-lead">{line}</p>}
        {mine && deal.heldAmount > 0 && (
          <HeldBadge>
            {deal.payMode === "direct"
              ? t("direct.helperBadge", { amount: fmtMoney(owedToHelper(deal)) })
              : t("money.heldBadge", { amount: fmtMoney(deal.heldAmount) })}
          </HeldBadge>
        )}
      </DetailTitle>

      {chatAccess.inquiry ? (
        <Link href={`/chat/${deal.id}`} className={btn.secondary}>
          {t("chat.askQuestion")}
          {unread ? ` · ${t("chat.unread", { n: unread })}` : ""}
        </Link>
      ) : (
        unread !== null && <ContactRow dealId={deal.id} unread={unread} canCall={callsEnabled() && callParty(deal, me) !== null} t={t} />
      )}
      {payee && (
        <Note tone="info">
          <Link href={`/orgs/${payee.id}`} className="font-semibold underline">
            {t("org.payee", { name: payee.name })}
          </Link>
          <br />
          {t("org.workerPay")}
        </Note>
      )}
      {mine && directPayOpen(deal) && <DirectPayHelperCard dealId={deal.id} state={await directPayState(deal)} action={jobAction} t={t} />}
      {mine && <SafetyBar dealId={deal.id} showSos={(SOS_STATUSES as readonly string[]).includes(deal.status)} live={sos} />}
      {mine && (
        <PriceChangeCard deal={deal} me="helper" otherName={customer?.name ?? t("deal.customer")} action={jobAction} pay={null} t={t} />
      )}

      {/* the key facts in one lined card (PleaseHelp-style): what it pays · what to buy · when */}
      <DetailRows
        rows={[
          {
            label: payee ? t("org.payee", { name: payee.name }) : t("job.feeLabel"),
            value: <span className="text-heading font-bold tabular-nums leading-tight text-brand-ink">{fmtMoney(net)}</span>,
          },
          {
            label: t("job.itemsLabel"),
            value:
              deal.itemBudget > 0 ? (
                <>
                  <span className="block text-title font-bold tabular-nums">
                    {t("job.itemsUpTo", { amount: fmtMoney(deal.itemBudget) })}
                  </span>
                  <span className="block text-small text-ink-2">
                    {t(deal.payMode === "direct" ? "direct.helper.itemsHow" : "job.itemsHow")}
                  </span>
                </>
              ) : categoryConfig(deal.category).items && deal.category !== "deliver" ? (
                // a buying kind where the customer pays the shop (a parcel delivery buys nothing): the helper fronts nothing
                <>
                  <span className="block text-title font-bold">{t("job.customerPaysShop")}</span>
                  <span className="block text-small text-ink-2">{t("job.customerPaysShopHow")}</span>
                </>
              ) : (
                <span className="text-title font-semibold">{t("job.noItems")}</span>
              ),
          },
          {
            label: t("job.whenLabel"),
            value: (
              <>
                <span className="block text-title font-bold">{when}</span>
                {effort.length > 0 && <span className="block text-small text-ink-2">{effort.join(" · ")}</span>}
              </>
            ),
          },
        ]}
      />

      {deal.payMode !== "direct" && !payeeOrgId && ["open", "awaiting_payment", "matched", "in_progress"].includes(deal.status) && (
        <DetailSection label={t("job.paymentTimingTitle")}>
          <p className="text-small leading-relaxed text-ink-2">{t("job.paymentTiming", { hours: deal.checkHours })}</p>
        </DetailSection>
      )}

      <DetailSection label={t("job.placeLabel")}>
        <p className="whitespace-pre-line pb-1 text-lead">{deal.description}</p>
        <ConditionChips variety={deal.details.variety} require={deal.details.require} t={t} missing={missing} />
        <TaskPhotoGrid photos={photos} t={t} />
        <RouteStops
          stops={[
            ...(deal.pickupAddress
              ? [
                  {
                    key: "pickup",
                    kind: "pickup" as const,
                    children: (
                      <AddressBox
                        label={t("task.pickup")}
                        address={exact ? deal.pickupAddress : null}
                        hidden={t("job.addressAfterMatch")}
                        directionsUrl={exact ? pickupDirections : undefined}
                        directionsLabel={t("map.directionsShort")}
                      />
                    ),
                  },
                ]
              : []),
            {
              key: "drop",
              kind: "drop" as const,
              children: (
                <AddressBox
                  label={deal.pickupAddress || deal.pickupLocation ? t("task.drop") : t("task.where")}
                  address={exact ? deal.address : null}
                  hidden={t("job.addressAfterMatch")}
                  directionsUrl={exact ? directions : undefined}
                  directionsLabel={t("map.directionsShort")}
                />
              ),
            },
          ]}
        />
        {bits.length > 0 && <p className="text-body text-ink-2">{bits.join(" · ")}</p>}
        {mine && dt.note && <p className="rounded-input bg-fill p-3 text-body">{dt.note}</p>}
      </DetailSection>

      {mine && deal.status === "matched" && (
        <DetailSection label={t("proof.title")}>
          {/* the button itself is in the bottom bar, where the next step always is */}
          <Note tone="info">{startPhoto ? `${t("proof.startTitle")}: ${t("proof.startSub")}` : t("proof.careNoPhoto")}</Note>
        </DetailSection>
      )}
      {mine && deal.status === "in_progress" && (
        <DetailSection label={t("proof.title")}>
          <div className="flex flex-col gap-3">
            {deal.itemBudget > 0 && deal.topUp?.status !== "declined" && (
              <ProofUploader dealId={deal.id} kind="receipt" done={deal.receiptAmount !== null} />
            )}
            {deal.topUp?.status === "pending" && <Note tone="warn">{t("proof.waitTopUp")}</Note>}
            {/* not enough cash, over budget, or the customer simply pays: the shop's QR goes to them (2026-11-27) */}
            {categoryConfig(deal.category).items &&
              deal.category !== "deliver" &&
              (deal.itemBudget === 0 || deal.receiptAmount === null || deal.topUp?.status === "pending") && (
                <ConfirmSheet
                  action={jobAction}
                  fields={{ ...fields, intent: "customer_pays_shop" }}
                  trigger={t("shopPay.trigger")}
                  triggerClass={`${btn.secondary} w-full`}
                  title={t("shopPay.title")}
                  body={t(deal.itemBudget > 0 ? "shopPay.bodyBudget" : "shopPay.body")}
                  confirmLabel={t("shopPay.confirm")}
                />
              )}
            {startPhoto && <ProofUploader dealId={deal.id} kind="progress" done={false} />}
            {startPhoto ? (
              <ProofUploader dealId={deal.id} kind="handover" done={handoverLive} />
            ) : (
              <CareCheckOut dealId={deal.id} done={handoverLive} />
            )}
          </div>
        </DetailSection>
      )}
      {proofs.length > 0 && (
        <ProofGallery
          proofs={proofs}
          t={t}
          showFlags={false}
          action={(p) =>
            // while the job runs, the helper can take back their own progress / handover photo and take another
            mine && deal.status === "in_progress" && p.uploadedBy === me && (p.kind === "progress" || p.kind === "handover") && p.url ? (
              <ConfirmSheet
                action={removeMyProof}
                fields={{ dealId: deal.id, proofId: p.id }}
                trigger={t("proof.remove")}
                triggerClass={`${btn.text} min-h-9 self-start px-1 text-meta text-danger`}
                title={t("proof.removeTitle")}
                body={t("proof.removeBody")}
                confirmLabel={t("proof.remove")}
                confirmClass={btn.danger}
              />
            ) : null
          }
        />
      )}

      {/* finished: the helper rates the customer (helpers see it before taking their next task) */}
      {mine && deal.status === "released" && (
        <section className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-5">
          {myRating ? (
            <p className="text-small text-ink-2">{t("rateCustomer.done", { stars: myRating.stars })}</p>
          ) : (
            <ConfirmSheet
              action={jobAction}
              fields={{ dealId: deal.id, intent: "rate_customer" }}
              trigger={t("rateCustomer.open", { name: customer?.name ?? "—" })}
              triggerClass={`${btn.secondary} w-full`}
              title={t("rateCustomer.title", { name: customer?.name ?? "—" })}
              confirmLabel={t("rating.submit")}
            >
              <fieldset className="flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="cursor-pointer">
                    <input type="radio" name="stars" value={n} required defaultChecked={n === 5} className="peer sr-only" />
                    <span
                      aria-label={t("rating.stars", { n })}
                      className="flex h-12 w-12 items-center justify-center rounded-input border border-line text-title-lg text-ink-3 peer-checked:border-2 peer-checked:border-ink peer-checked:text-warn"
                    >
                      ★{n}
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                {CUSTOMER_TAGS.map((tag) => (
                  <label key={tag} className="cursor-pointer">
                    <input type="checkbox" name="tags" value={tag} className="peer sr-only" />
                    <span className="inline-flex min-h-11 items-center rounded-full bg-fill px-4 text-body peer-checked:bg-ink peer-checked:text-white">
                      {t(`rateCustomer.tags.${tag}`)}
                    </span>
                  </label>
                ))}
              </div>
              <label className={fieldLabel}>
                {t("rateCustomer.note")}
                <textarea name="note" maxLength={500} rows={3} className={field} />
              </label>
            </ConfirmSheet>
          )}
        </section>
      )}

      {/* finished: put some of these photos in the portfolio (the customer is asked first) */}
      {mine && deal.status === "released" && startPhoto && (
        <PortfolioAskSection dealId={deal.id} candidates={await portfolioCandidates(deal.id, me)} t={t} />
      )}

      {customer && (
        <DetailSection label={t("job.customerLabel")}>
          <p className="text-lead">
            {customer.name}
            {customerRating !== null ? ` · ★ ${customerRating.toFixed(1)} (${custStats?.customer_rating_count})` : ""}
          </p>
          {/* the customer verified their ID (2026-11-26) */}
          {(custStats?.kyc_level ?? 0) >= 3 && (
            <span className="w-fit rounded-full bg-held-bg px-2.5 py-1 text-caption font-bold text-held">{t("verify.badge")}</span>
          )}
        </DetailSection>
      )}

      {(primary || secondary.length > 0) && (
        <PrimaryBar>
          {/* applying, taking a price or starting needs a phone with notifications + location on */}
          {gateActions ? <WorkReady enforce={!(await deviceCheckBypassed(viewer.profile))} computerOk={await computerAllowed(viewer.profile.id)} positionSaved={await computerPositionFresh(viewer.profile.id)}>{primary}</WorkReady> : primary}
          {secondary.length > 0 && <div className="flex flex-wrap justify-center gap-1">{secondary}</div>}
        </PrimaryBar>
      )}
    </>
  );
}
