import { notFound } from "next/navigation";
import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import { AutoRefresh } from "@/components/auto-refresh";
import { Countdown } from "@/components/countdown";
import { InlineAction } from "@/components/inline-action";
import { JobBeacon } from "@/components/job-beacon";
import { ProofGallery } from "@/components/proof-gallery";
import { ProofUploader } from "@/components/proof-uploader";
import { CareCheckOut } from "@/components/care-check-out";
import { TaskMap, type MapMarker } from "@/components/task-map";
import { ConfirmSheet } from "@/components/sheet";
import { AddressBox, DetailPair, DetailSection, DetailTitle, MapHero } from "@/components/detail";
import { StatusBadge } from "@/components/status-badge";
import { FlowHeader, HeldBadge, Note, PrimaryBar, btn, field, fieldLabel } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getJobForHelper, publicProfiles } from "@/lib/deals/queries";
import { DEFAULT_CONFIG, categoryTrust, errandSplit, invitedOnly } from "@/lib/engine";
import { pauseDaysFor, recentBackOuts } from "@/lib/penalties";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { fuzz, googleDirectionsUrl, helperStart } from "@/lib/maps";
import { accessFor, unreadCount } from "@/lib/chat";
import { callParty } from "@/lib/calls";
import { proofsFor } from "@/lib/proofs";
import { taskPhotosFor } from "@/lib/task-photos";
import { workedTogether } from "@/lib/care";
import { TaskPhotoGrid } from "@/components/task-photo-grid";
import { SafetyBar } from "@/components/safety-bar";
import { PriceChangeCard } from "@/components/price-change-card";
import { SOS_STATUSES } from "@/lib/incident-rules";
import { liveSos } from "@/lib/incidents";
import { organizationNames } from "@/lib/orgs";
import { ContactRow } from "../../tasks/[id]/deal-view";
import { jobAction, removeMyProof } from "../actions";

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
  // while bargaining, the price on the table between this helper and the customer
  const onTable = deal.status === "open" && myOffer?.price != null ? myOffer.price : deal.fee;
  const net = errandSplit({ fee: onTable, itemBudget: 0, receipt: null, serviceFee: deal.serviceFee, commissionBps: deal.commissionBps }).helperFeeNet;
  const fields = { dealId: deal.id };
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
    : t("job.nowFor", { dur: duration });
  const effort = [
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
        <input name="price" inputMode="numeric" defaultValue={String(start)} className={`${field} text-[20px] font-bold tabular-nums`} required />
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
  const payeeOrgId = deal.helperId ? deal.payeeOrgId : myOffer ? myOffer.orgId : qualification?.orgId ?? null;
  const payee = payeeOrgId ? (await organizationNames([payeeOrgId])).get(payeeOrgId) : undefined;
  const canTake = viewer.actor.helperApproved && (specialized ? Boolean(qualification) : (viewer.actor.categories ?? []).includes(deal.category));
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
  if (deal.status === "open" && !myOffer && !canTake) {
    line = viewer.actor.helperApproved
      ? specialized ? t("specialized.qualified") : t("job.needCategory", { category: t(`categoryShort.${deal.category}`) })
      : t("job.needApproval");
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
    secondary.push(declineSheet || <InlineAction key="skip" action={jobAction} fields={{ ...fields, intent: "skip" }} label={t("job.skip")} className={btn.text} />);
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
      declineSheet || <InlineAction key="unapply" action={jobAction} fields={{ ...fields, intent: "unapply" }} label={t("job.unapply")} className={btn.text} />,
    );
  } else if (mine && deal.status === "awaiting_payment") {
    line = deal.payBy ? <Countdown until={deal.payBy} serverNow={now} template={t("job.waitingPay")} /> : null;
  } else if (mine && deal.status === "matched") {
    line = t("job.paidGo");
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
        <InlineAction action={jobAction} fields={{ ...fields, intent: "finish" }} label={`✓ ${t("proof.finish")}`} className={`${btn.primary} w-full`} />
      );
      line = t("proof.finishSub", { hours: deal.checkHours });
    }
  }
  if (mine && (deal.status === "awaiting_payment" || deal.status === "matched" || deal.status === "in_progress")) {
    // Backing out (docs/decisions.md 2026-11-17): free within 10 minutes of being chosen, then an
    // escalating pause; either way the task is posted anew and the customer is refunded.
    const late = deal.assignedAt === null || now - deal.assignedAt > DEFAULT_CONFIG.backOutGraceMinutes * 60_000;
    const days = late ? pauseDaysFor((await recentBackOuts(me, now)) + 1, categoryTrust(deal.category) === "care") : 0;
    secondary.push(
      <ConfirmSheet
        key="cancel"
        action={jobAction}
        fields={{ ...fields, intent: "withdraw" }}
        trigger={t("job.cancelLate")}
        triggerClass={late ? btn.textDanger : btn.text}
        title={t("job.cancelLateTitle")}
        body={late ? t("job.cancelLateBody", { days: days === 1 ? t("job.pauseDay") : t("job.pauseDays", { n: days }) }) : t("job.cancelFreeBody")}
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


  const photos = await taskPhotosFor(deal.id);
  const firstMeeting = !startPhoto && mine && !(await workedTogether(deal.customerId, [me])).has(me);
  const chatAccess = await accessFor(deal, me);
  const unread = chatAccess.canRead && chatAccess.threadHelperId ? await unreadCount(deal.id, chatAccess.threadHelperId, me) : null;
  const sos = mine ? await liveSos(deal.id, me) : null;

  const pickupDirections = deal.pickupLocation || deal.pickupAddress ? googleDirectionsUrl(deal.pickupLocation ?? (deal.pickupAddress as string)) : undefined;

  return (
    <>
      {markers.length === 0 && <FlowHeader href="/jobs" label={t("common.back")} />}
      {onJob && <JobBeacon dealId={deal.id} />}
      {(deal.status === "open" || deal.status === "awaiting_payment") && <AutoRefresh seconds={10} />}

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
            openUrl={exact ? directions : helperStart(deal) ? googleDirectionsUrl(fuzz(helperStart(deal) as { lat: number; lng: number })) : undefined}
          />
        </MapHero>
      )}

      <DetailTitle
        tag={
          <>
            <CategoryIcon id={deal.category} size={16} /> {t(`categoryShort.${deal.category}`)}
          </>
        }
        status={<StatusBadge status={deal.status} t={t} />}
        title={deal.title}
        overlap={markers.length > 0}
      >
        {invitedMe && deal.invite && (
          <Note tone="info">
            {t("invite.toYou", { name: customer?.name ?? t("deal.customer") })}{" "}
            {deal.invite.openAfter ? <Countdown until={deal.invite.until} serverNow={now} template={t("invite.toYouUntil")} /> : t("invite.toYouOnly")}
          </Note>
        )}
        {deal.status === "open" && categoryTrust(deal.category) === "care" && <Note tone="warn">{t("care.helperNote")}</Note>}
        {!startPhoto && <Note tone="info">{t(deal.category === "eldercare" ? "care.scopeElder" : "care.scopeChild")}</Note>}
        {!startPhoto && mine && firstMeeting && <Note tone="info">{t("care.meetFirstHelper")}</Note>}
        {line && <p className="text-[16px]">{line}</p>}
        {mine && deal.heldAmount > 0 && <HeldBadge>{t("money.heldBadge", { amount: fmtMoney(deal.heldAmount) })}</HeldBadge>}
      </DetailTitle>

      {unread !== null && <ContactRow dealId={deal.id} unread={unread} canCall={callParty(deal, me) !== null} t={t} />}
      {payee && <Note tone="info"><Link href={`/orgs/${payee.id}`} className="font-semibold underline">{t("org.payee", { name: payee.name })}</Link><br />{t("org.workerPay")}</Note>}
      {mine && <SafetyBar dealId={deal.id} showSos={(SOS_STATUSES as readonly string[]).includes(deal.status)} live={sos} />}
      {mine && <PriceChangeCard deal={deal} me="helper" otherName={customer?.name ?? t("deal.customer")} action={jobAction} pay={null} t={t} />}

      {/* what it pays | what to buy — "no purchase" is said, not implied */}
      <DetailPair
        left={{ label: payee ? t("org.payee", { name: payee.name }) : t("job.feeLabel"), value: <span className="text-[24px] font-bold tabular-nums leading-tight text-brand-ink">{fmtMoney(net)}</span> }}
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
        <TaskPhotoGrid photos={photos} t={t} />
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
                triggerClass={`${btn.text} min-h-9 self-start px-1 text-[13px] text-danger`}
                title={t("proof.removeTitle")}
                body={t("proof.removeBody")}
                confirmLabel={t("proof.remove")}
                confirmClass={btn.danger}
              />
            ) : null
          }
        />
      )}

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
