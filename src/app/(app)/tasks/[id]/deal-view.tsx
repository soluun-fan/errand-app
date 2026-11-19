import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import type { ReactNode } from "react";
import { Countdown } from "@/components/countdown";
import { MoneyBreakdown, type MoneyRow } from "@/components/money-breakdown";
import { OfferCard, type OfferPerson } from "@/components/offer-card";
import { ConfirmSheet, type FormAction } from "@/components/sheet";
import { StatusBadge } from "@/components/status-badge";
import { StepTracker } from "@/components/step-tracker";
import { Card, FlowHeader, HeldBadge, PrimaryBar, btn, field, fieldLabel } from "@/components/ui";
import type { Locale, T } from "@/i18n";
import type { PublicProfile, TimelineItem } from "@/lib/deals/queries";
import { amountDue, autoPickAt, categoryTrust, errandSplit, invitedOnly, liveOffers, type ErrandDeal } from "@/lib/engine";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { DISPUTE_REASONS, RATING_TAGS, describeEvent } from "@/lib/labels";
import { TaskMap, type MapMarker } from "@/components/task-map";
import { googleDirectionsUrl, googlePlaceUrl } from "@/lib/maps";
import { distanceKm } from "@/lib/dispatch/plan";
import { callParty, callsEnabled } from "@/lib/calls";
import { AddressBox, DetailSection, DetailTitle, MapHero } from "@/components/detail";
import { ProofGallery } from "@/components/proof-gallery";
import type { ProofView } from "@/lib/proofs";
import type { TaskPhotoView } from "@/lib/task-photos";
import { TaskPhotoGrid } from "@/components/task-photo-grid";
import { TaskPhotoManager } from "@/components/task-photo-manager";
import { MockQr } from "./mock-qr";
import { PaySheet } from "./pay-sheet";
import { DirectPayCustomerCard } from "@/components/direct-pay-card";
import { BadgeChips, ConditionChips } from "@/components/conditions";
import type { HelperBadges } from "@/lib/engine";
import type { OnTime } from "@/lib/badges";
import type { DirectPayState, PayeeAccount } from "@/lib/direct-pay";
import { PriceChangeCard } from "@/components/price-change-card";
import { ReviewPhotoPicker } from "@/components/review-photo-picker";

export interface DealViewProps {
  deal: ErrandDeal;
  events: TimelineItem[];
  people: Map<string, PublicProfile>;
  organizations?: Map<string, { id: string; name: string }>;
  viewerId: string;
  serverNow: number;
  t: T;
  locale: Locale;
  /** Stars the viewer already gave, or null. */
  rated: number | null;
  autoOpenPay: boolean;
  mockPay: boolean;
  /** Real payments go through wire.mn's checkout page (else the simulated button). */
  wirePay?: boolean;
  /** Fee-only tasks, once the job is done: what the customer owes the helper and where to pay. */
  directPay?: { state: DirectPayState; account: PayeeAccount | null } | null;
  action: FormAction;
  /** Dispatch progress while the task is open (how many helpers were notified). */
  dispatch?: { notified: number } | null;
  /** Live applicants, best first (dispatch score); the first is "Recommended". */
  ranked?: { helperId: string; distanceKm: number | null }[];
  /** Live helper position during the job (customer only). */
  helperPos?: { lat: number; lng: number } | null;
  /** Photo / video proof with signed URLs. */
  proofs?: ProofView[];
  /** The customer's own photos of the task (signed URLs). */
  photos?: TaskPhotoView[];
  /** The customer may still change them (their task, still open). */
  photosEditable?: boolean;
  /** Chat entry (null when there's no conversation for this viewer). */
  chat?: { unread: number } | null;
  /** Unread messages per applicant (while choosing). */
  applicantUnread?: Map<string, number>;
  /** Care work: applicants the customer has already had a real call with (needed before choosing). */
  careCalls?: Set<string>;
  /** A call before choosing is required (care work, or the customer's "talk first" condition). */
  needsCall?: boolean;
  /** Applicants' badges for the task's conditions (driver, car, checked, on time, languages). */
  applicantBadges?: Map<string, HelperBadges & { record: OnTime }>;
  /** The handover code to tell the helper at handover (customer only, while the job runs). */
  handoverCode?: string | null;
  /** Care: applicants this family already had a finished care job with (no "meet first" needed). */
  careKnown?: Set<string>;
  /** Care: the required call length (Ops rule). */
  careCallSeconds?: number;
  /** Care: applicants with an Ops-approved first-aid certificate. */
  firstAid?: Set<string>;
  /** SOS / report-a-problem row (client component, passed in by the page). */
  safety?: ReactNode;
  /** Finished task: the helper's request to show photos + the task's public photos. */
  workPhotos?: ReactNode;
}

const person = (p: PublicProfile | undefined, fallback: string): OfferPerson => ({
  name: p?.name ?? fallback,
  rating: p?.rating ?? null,
  ratingCount: p?.rating_count ?? 0,
  completed: p?.completed_count ?? 0,
  verified: (p?.kyc_level ?? 0) >= 3,
});

/**
 * The deal screen (UI-FLOWS C4–C8): status first (tracker + one plain line), then people,
 * money and details; one primary action in the sticky bar. Pure render — the gallery
 * (/dev/ui) uses it with fixture data.
 */
/** "💬 Чат" with an unread badge. */
/** Call | Chat side by side (both open the deal's chat, where the call buttons are). Call only while a call is allowed. */
export function ContactRow({ dealId, unread, canCall, t, withHelper = null }: { dealId: string; unread: number; canCall: boolean; t: T; withHelper?: string | null }) {
  // the customer talking to one applicant (before choosing) opens that applicant's conversation
  const href = withHelper ? `/chat/${dealId}?with=${withHelper}` : `/chat/${dealId}`;
  return (
    <div className={`grid gap-2 ${canCall ? "grid-cols-2" : "grid-cols-1"}`}>
      {canCall && (
        <Link href={href} className={`${btn.secondary} w-full`}>
          📞 {t("call.voice")}
        </Link>
      )}
      <Link href={href} className={`${btn.small} relative w-full`}>
        💬 {t("chat.open")}
        {unread > 0 && <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">{t("chat.unread", { n: unread })}</span>}
      </Link>
    </div>
  );
}

export function DealView(p: DealViewProps) {
  const { deal, events, people, t, locale, serverNow } = p;
  const isCustomer = deal.customerId === p.viewerId;
  const care = categoryTrust(deal.category) === "care";
  const name = (uid: unknown) => (typeof uid === "string" ? (people.get(uid)?.name ?? p.organizations?.get(uid)?.name ?? t("deal.newHelper")) : "—");
  const helperName = deal.helperId ? name(deal.helperId) : "";
  const payeeName = deal.payeeOrgId ? p.organizations?.get(deal.payeeOrgId)?.name ?? t("org.title") : helperName;
  const split = errandSplit({
    fee: deal.fee,
    itemBudget: deal.itemBudget,
    receipt: deal.receiptAmount,
    serviceFee: deal.serviceFee,
    commissionBps: deal.commissionBps,
  });
  const fields = { dealId: deal.id };
  // Live applicants, best first (the page ranks them; unranked ones keep their order).
  const rankOf = (h: string) => p.ranked?.findIndex((r) => r.helperId === h) ?? -1;
  const applicants = liveOffers(deal, serverNow).filter((o) => !p.ranked || p.ranked.some((r) => r.helperId === o.helperId)).sort((a, b) => {
    const ra = rankOf(a.helperId);
    const rb = rankOf(b.helperId);
    return (ra < 0 ? 1e9 : ra) - (rb < 0 ? 1e9 : rb);
  });
  const pickAt = autoPickAt(deal, serverNow);
  const topUp = deal.topUp;
  const topUpPending = deal.status === "in_progress" && topUp?.status === "pending" ? topUp : null;
  const againLink = (cls: string) => (
    <Link key="again" href={`/post?again=${deal.id}`} className={cls}>
      {t("deal.postAgain")}
    </Link>
  );
  const cancelFeePaid = events.find((e) => e.code === "cancel_fee_paid");
  /** fee-only task (docs/decisions.md 2026-11-18): only our fee went through the app */
  const direct = deal.payMode === "direct";
  const dt = deal.details;
  const detailBits = [
    dt.entrance && t("details.entrance", { v: dt.entrance }),
    dt.floor !== null && t("details.floor", { v: dt.floor }),
    dt.unit && t("details.unit", { v: dt.unit }),
    dt.lift === "yes" ? t("details.liftYes") : dt.lift === "no" ? t("details.liftNo") : null,
    dt.people === 2 && t("details.people", { n: 2 }),
  ].filter((x): x is string => typeof x === "string" && x.length > 0);

  /* ---------- the one status line ---------- */
  let line: ReactNode;
  switch (deal.status) {
    case "awaiting_payment":
      line = deal.payBy ? (
        <Countdown
          until={deal.payBy}
          serverNow={serverNow}
          template={
            direct
              ? t("direct.line.awaiting", { helper: helperName, fee: fmtMoney(deal.serviceFee), time: "{time}" })
              : t("deal.line.awaiting_payment", { helper: helperName, time: "{time}" })
          }
        />
      ) : null;
      break;
    case "open":
      line = invitedOnly(deal, serverNow) !== null && deal.invite ? (
        // a direct request: waiting on the one helper the customer picked
        <>
          {t("invite.waiting", { name: name(deal.invite.helperId) })}{" "}
          {deal.invite.openAfter && <Countdown until={deal.invite.until} serverNow={serverNow} template={t("invite.opensIn")} />}
        </>
      ) : (
        <>
          {deal.mode === "now"
            ? deal.offers.length > 0
              ? t("deal.line.openChoose", { n: deal.offers.length })
              : p.dispatch?.notified
                ? t("deal.line.openNow", { n: p.dispatch.notified })
                : t("deal.line.openNowStart")
            : t("deal.line.openSchedule", { offers: deal.offers.length, max: deal.maxApplicants })}{" "}
          {deal.matchBy && t("deal.line.noMatchBy", { when: fmtDateTime(deal.matchBy, locale) })}
        </>
      );
      break;
    case "matched":
      line = direct ? t("direct.line.matched", { helper: helperName }) : t("deal.line.matched", { helper: helperName });
      break;
    case "in_progress":
      line = t("deal.line.in_progress", { helper: helperName });
      break;
    case "check":
      line = (
        <>
          {t("deal.line.check", { helper: helperName })}{" "}
          {deal.checkUntil && (
            <span className="mt-2 block">
              <Countdown until={deal.checkUntil} serverNow={serverNow} template={t("deal.autoConfirm")} pill />
            </span>
          )}
          <span className="mt-1.5 block text-sm text-ink-2">{t("deal.autoConfirmInfo")}</span>
        </>
      );
      break;
    case "disputed":
      line = direct ? t("direct.line.disputed") : t("deal.line.disputed");
      break;
    case "released":
      line = direct
        ? t("direct.line.released", { helper: payeeName })
        : split.refund > 0
          ? t("deal.line.releasedRefund", { amount: fmtMoney(split.refund) })
          : t("deal.line.released", { helper: payeeName });
      break;
    case "refunded":
      line = direct ? t("direct.line.refunded", { amount: fmtMoney(deal.serviceFee) }) : t("deal.line.refunded", { amount: fmtMoney(amountDue(deal)) });
      break;
    case "cancelled":
      line = events.some((e) => e.code === "fee_kept")
        ? t("direct.line.cancelledKept", { fee: fmtMoney(deal.serviceFee) })
        : cancelFeePaid
        ? deal.payeeOrgId ? t("org.cancelledFee", { fee: fmtMoney(Number(cancelFeePaid.data.amount ?? 0)), name: payeeName }) : t("deal.line.cancelledFee", { fee: fmtMoney(Number(cancelFeePaid.data.amount ?? 0)) })
        : t("deal.line.cancelled");
      break;
    case "expired": {
      // say why it ended: refunded (old paid-at-posting deals), the one invited helper said no,
      // the match wasn't paid in time, or simply nobody took it
      const declined = events.find((e) => e.code === "invite_declined");
      line = deal.paymentRef
        ? t("deal.line.expiredNoHelper", { amount: fmtMoney(amountDue(deal)) })
        : declined
          ? t("deal.line.expiredDeclined", { name: name(declined.data.helperId) })
          : events.some((e) => e.code === "payment_expired")
            ? t("deal.line.expiredUnpaid")
            : t("deal.line.expiredNobody");
      break;
    }
  }
  const duration = deal.details.minutes >= 60 ? t("price.hours", { n: deal.details.minutes / 60 }) : t("price.min", { n: deal.details.minutes });
  const when = deal.scheduledAt
    ? t("job.startsAt", { time: fmtDateTime(deal.scheduledAt, locale), dur: duration })
    : deal.mode === "schedule" && deal.matchBy
      ? t("job.flexibleFor", { time: fmtDateTime(deal.matchBy, locale), dur: duration }) // not urgent: open until then
      : t("job.nowFor", { dur: duration });
  const waiting = ["awaiting_payment", "open", "matched", "in_progress", "check", "disputed"].includes(deal.status);

  /* ---------- money: where it is now ---------- */
  let money: ReactNode;
  if (direct && !["refunded", "cancelled", "expired"].includes(deal.status)) {
    // fee-only: what goes through the app now, and what the customer pays the helper themselves
    const done = ["check", "disputed", "released"].includes(deal.status);
    const rows: MoneyRow[] = [
      { label: t(done ? "direct.money.toHelperNow" : "direct.money.toHelperLater"), amount: done ? deal.fee + (deal.receiptAmount ?? 0) : deal.fee },
    ];
    if (deal.itemBudget > 0 && !done) rows.push({ label: t("direct.money.itemsLater"), amount: deal.itemBudget, muted: true });
    rows.push({ label: t(deal.heldAmount > 0 || done ? "direct.money.feePaid" : "direct.money.feeNow"), amount: deal.serviceFee });
    money = <MoneyBreakdown rows={rows} total={{ label: t(deal.status === "awaiting_payment" ? "direct.money.payNow" : "direct.money.feeTotal"), amount: deal.serviceFee }} />;
  } else if (["check", "disputed", "released"].includes(deal.status)) {
    const rows: MoneyRow[] = [
      { label: deal.payeeOrgId ? t("org.payee", { name: payeeName }) : deal.commissionBps > 0 ? t("money.toHelperFee", { pct: deal.commissionBps / 100 }) : t("money.toHelper"), amount: split.helperFeeNet },
    ];
    if (deal.itemBudget > 0) {
      rows.push({ label: deal.payeeOrgId ? t("org.payeeItems", { name: payeeName }) : t("money.toHelperItems"), amount: split.spent });
      rows.push({ label: t("money.backToYou"), amount: split.refund });
    }
    // the platform's fee is never the organisation's money, whoever did the job
    rows.push({ label: deal.commissionBps > 0 ? t("money.platform") : t("money.serviceFee"), amount: split.platform, muted: true });
    money = <MoneyBreakdown rows={rows} total={{ label: t("money.totalHeld"), amount: split.held }} />;
  } else if (!["refunded", "cancelled", "expired"].includes(deal.status)) {
    const rows: MoneyRow[] = [{ label: t("money.helperFee"), amount: deal.fee }];
    if (deal.itemBudget > 0) rows.push({ label: t("money.itemBudget"), amount: deal.itemBudget });
    rows.push({ label: t("money.serviceFee"), amount: deal.serviceFee, muted: true });
    money = (
      <MoneyBreakdown
        rows={rows}
        total={{ label: t("money.totalHeld"), amount: amountDue(deal) }}
        caption={deal.itemBudget > 0 ? t("money.itemBudgetNote") : undefined}
      />
    );
  }

  /* ---------- primary + secondary actions (customer only) ---------- */
  let primary: ReactNode = null;
  const secondary: ReactNode[] = [];
  if (isCustomer) {
    switch (deal.status) {
      case "awaiting_payment":
        primary = (
          <PaySheet
            dealId={deal.id}
            amountLabel={fmtMoney(amountDue(deal))}
            payBy={deal.payBy}
            serverNow={serverNow}
            defaultOpen={p.autoOpenPay}
            mock={p.mockPay}
            wire={p.wirePay}
            doneLabel={direct ? t("pay.feeDone") : undefined}
            action={p.action}
            qr={<MockQr seed={deal.id} />}
          />
        );
        secondary.push(
          <ConfirmSheet
            key="cancel"
            action={p.action}
            fields={{ ...fields, intent: "cancel" }}
            trigger={t("deal.cancel")}
            triggerClass={btn.text}
            title={t("deal.cancelFreeTitle")}
            body={t("deal.cancelUnpaidBody")}
            confirmLabel={t("deal.cancel")}
            confirmClass={btn.danger}
          />,
        );
        break;
      case "open":
        if (!care && invitedOnly(deal, serverNow) !== null) {
          secondary.push(
            <ConfirmSheet
              key="open_to_all"
              action={p.action}
              fields={{ ...fields, intent: "open_to_all" }}
              trigger={t("invite.openNow")}
              triggerClass={btn.text}
              title={t("invite.openNowTitle")}
              body={t("invite.openNowBody")}
              confirmLabel={t("invite.openNow")}
            />,
          );
        }
        secondary.push(
          <ConfirmSheet
            key="cancel"
            action={p.action}
            fields={{ ...fields, intent: "cancel" }}
            trigger={t("deal.cancel")}
            triggerClass={btn.text}
            title={t("deal.cancelFreeTitle")}
            body={deal.heldAmount > 0 ? t("deal.cancelFreeBody", { amount: fmtMoney(deal.heldAmount) }) : t("deal.cancelUnpaidBody")}
            confirmLabel={t("deal.cancel")}
            confirmClass={btn.danger}
          />,
        );
        break;
      case "in_progress":
        if (topUpPending) {
          primary = (
            <PaySheet
              dealId={deal.id}
              amountLabel={fmtMoney(topUpPending.amount)}
              payBy={null}
              serverNow={serverNow}
              defaultOpen={false}
              mock={p.mockPay}
              action={p.action}
              qr={<MockQr seed={`${deal.id}-topup`} />}
              intent="simulate_topup"
              triggerLabel={t("deal.topUp.approve", { amount: fmtMoney(topUpPending.amount) })}
            />
          );
          secondary.push(
            <ConfirmSheet
              key="decline"
              action={p.action}
              fields={{ ...fields, intent: "decline_topup" }}
              trigger={t("deal.topUp.decline")}
              triggerClass={btn.text}
              title={t("deal.topUp.declineTitle", { amount: fmtMoney(topUpPending.amount) })}
              body={t("deal.topUp.declineBody", { helper: helperName })}
              confirmLabel={t("deal.topUp.declineConfirm")}
              confirmClass={btn.danger}
            />,
          );
        }
        break;
      case "matched":
        secondary.push(
          <ConfirmSheet
            key="cancel"
            action={p.action}
            fields={{ ...fields, intent: "cancel" }}
            trigger={t("deal.cancel")}
            triggerClass={btn.textDanger}
            title={t("deal.cancelFeeTitle")}
            body={t("deal.cancelFeeBody", {
              fee: fmtMoney(deal.cancelFee),
              helper: helperName,
              refund: fmtMoney(deal.heldAmount - deal.cancelFee),
            })}
            confirmLabel={t("deal.cancel")}
            confirmClass={btn.danger}
          />,
        );
        break;
      case "check":
        primary = (
          <ConfirmSheet
            action={p.action}
            fields={{ ...fields, intent: "confirm" }}
            trigger={t("deal.confirmDone")}
            triggerClass={`${btn.primary} w-full`}
            title={t("deal.confirmTitle")}
            body={
              split.refund > 0
                ? t("deal.confirmBodyRefund", { helper: payeeName, net: fmtMoney(split.helperNet), refund: fmtMoney(split.refund) })
                : t("deal.confirmBody", { helper: payeeName, net: fmtMoney(split.helperNet) })
            }
            confirmLabel={t("deal.confirmDone")}
          />
        );
        secondary.push(
          <ConfirmSheet
            key="dispute"
            action={p.action}
            fields={{ ...fields, intent: "dispute" }}
            trigger={t("deal.problem")}
            triggerClass={btn.textDanger}
            title={t("dispute.title")}
            confirmLabel={t("dispute.submit")}
            confirmClass={btn.danger}
          >
            <fieldset className="flex flex-col">
              {DISPUTE_REASONS.map((r, i) => (
                <label key={r} className="flex min-h-11 items-center gap-3 text-[15px]">
                  <input type="radio" name="reason" value={r} defaultChecked={i === 0} className="h-5 w-5 accent-danger" />
                  {t(`dispute.reasons.${r}`)}
                </label>
              ))}
            </fieldset>
            <label className={fieldLabel}>
              {t("dispute.note")}
              <textarea name="note" required minLength={20} maxLength={1000} rows={3} className={field} placeholder={t("dispute.notePh")} />
            </label>
            <p className="rounded-input bg-warn-bg p-3 text-sm text-warn">{t(direct ? "direct.disputeWhat" : "dispute.what")}</p>
          </ConfirmSheet>,
        );
        break;
      case "released":
        if (p.rated === null && deal.helperId) {
          primary = (
            <ConfirmSheet
              action={p.action}
              fields={{ ...fields, intent: "rate" }}
              trigger={t("deal.rate", { name: helperName })}
              triggerClass={`${btn.primary} w-full`}
              title={t("rating.title", { name: helperName })}
              confirmLabel={t("rating.submit")}
            >
              <fieldset className="flex justify-center gap-1" aria-label={t("rating.title", { name: helperName })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="cursor-pointer">
                    <input type="radio" name="stars" value={n} required defaultChecked={n === 5} className="peer sr-only" />
                    <span
                      aria-label={t("rating.stars", { n })}
                      className="flex h-12 w-12 items-center justify-center rounded-input border border-line text-xl text-ink-3 peer-checked:border-2 peer-checked:border-ink peer-checked:text-warn peer-focus-visible:outline-2 peer-focus-visible:outline-ink"
                    >
                      ★{n}
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                {RATING_TAGS.map((tag) => (
                  <label key={tag} className="cursor-pointer">
                    <input type="checkbox" name="tags" value={tag} className="peer sr-only" />
                    <span className="inline-flex min-h-11 items-center rounded-full bg-fill px-4 text-[15px] peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-ink">
                      {t(`rating.tags.${tag}`)}
                    </span>
                  </label>
                ))}
              </div>
              <label className={fieldLabel}>
                {t("rating.note")}
                <textarea name="note" maxLength={500} rows={2} className={field} />
              </label>
              {/* no public photos of care work (children, elders) */}
              {categoryTrust(deal.category) !== "care" && <ReviewPhotoPicker dealId={deal.id} />}
              <p className="text-[13px] text-ink-2">{t("helperProfile.reviewPublic")}</p>
            </ConfirmSheet>
          );
          secondary.push(againLink(btn.text));
        } else {
          primary = againLink(`${btn.primary} w-full`);
        }
        break;
      case "refunded":
      case "cancelled":
      case "expired":
        primary = againLink(`${btn.primary} w-full`);
        break;
    }
  }

  return (
    <>
      {!(deal.location && waiting) && <FlowHeader href="/" label={t("common.back")} />}

      {deal.location && waiting && (
        <MapHero
          backHref="/"
          backLabel={t("common.back")}
          caption={
            p.helperPos ? (
              <>
                {t("map.helperHere", { name: helperName, km: distanceKm(p.helperPos, deal.location).toFixed(1) })}
              </>
            ) : undefined
          }
        >
          <TaskMap
            rounded={false}
            className="h-[44vh] min-h-64"
            markers={[
              ...(deal.pickupLocation ? [{ ...deal.pickupLocation, kind: "pickup", label: deal.pickupAddress ?? t("map.pickup") } as MapMarker] : []),
              { ...deal.location, kind: "task", label: deal.address } as MapMarker,
              ...(p.helperPos ? [{ ...p.helperPos, kind: "helper", label: helperName } as MapMarker] : []),
            ]}
            // the trip: helper → pickup → drop-off
            route={[...(p.helperPos ? [p.helperPos] : []), ...(deal.pickupLocation ? [deal.pickupLocation] : []), deal.location]}
            // tap the map: Google Maps with the same trip (from the helper while they're on the way)
            openUrl={
              p.helperPos || deal.pickupLocation
                ? googleDirectionsUrl(deal.location, p.helperPos ? deal.pickupLocation : null, p.helperPos ?? deal.pickupLocation)
                : googlePlaceUrl(deal.location)
            }
          />
        </MapHero>
      )}

      {/* status first */}
      <DetailTitle
        tag={
          <>
            <CategoryIcon id={deal.category} size={16} /> {t(`categoryShort.${deal.category}`)}
          </>
        }
        status={<StatusBadge status={deal.status} t={t} />}
        title={deal.title}
        overlap={Boolean(deal.location && waiting)}
      >
        <StepTracker status={deal.status} events={events} t={t} />
        <div className="text-[16px] text-ink">{line}</div>
        {deal.heldAmount > 0 && <HeldBadge>{direct ? t("direct.badge", { amount: fmtMoney(deal.heldAmount) }) : t("money.heldBadge", { amount: fmtMoney(deal.heldAmount) })}</HeldBadge>}
        {p.rated !== null && <p className="text-sm text-ink-2">{t("deal.rated", { stars: p.rated })}</p>}
        {waiting && (
          <Link href="/help" className="self-start text-[15px] font-medium text-ink underline underline-offset-4">
            {t("common.needHelp")}
          </Link>
        )}
      </DetailTitle>

      {deal.helperId && (
        <OfferCard
          person={person(people.get(deal.helperId), helperName)}
          organization={deal.payeeOrgId ? p.organizations?.get(deal.payeeOrgId) : undefined}
          href={`/helpers/${deal.helperId}`}
          t={t}
          action={p.chat ? <ContactRow dealId={deal.id} unread={p.chat.unread} canCall={callsEnabled() && callParty(deal, p.viewerId) !== null} t={t} /> : undefined}
        />
      )}

      {p.safety}

      {isCustomer && (
        <PriceChangeCard
          deal={deal}
          me="customer"
          otherName={helperName}
          action={p.action}
          t={t}
          pay={
            deal.priceChange?.status === "awaiting_payment" ? (
              <PaySheet
                dealId={deal.id}
                amountLabel={fmtMoney(deal.priceChange.fee - deal.fee)}
                payBy={null}
                serverNow={serverNow}
                defaultOpen={false}
                mock={p.mockPay}
                action={p.action}
                qr={<MockQr seed={`${deal.id}-price`} />}
                intent="simulate_price_payment"
                triggerLabel={t("priceChange.payButton", { amount: fmtMoney(deal.priceChange.fee - deal.fee) })}
              />
            ) : null
          }
        />
      )}

      {deal.status === "open" && isCustomer && care && <p className="rounded-input bg-fill p-3">{t("care.launchScope")}</p>}
      {deal.status === "open" && isCustomer && !care && (
        <section className="flex flex-col gap-2" aria-live="polite">
          <h2 className="font-bold">{t("deal.offers", { n: applicants.length, max: deal.maxApplicants })}</h2>
          {deal.category === "escort" && <p className="text-sm text-ink-2">{t("care.posterChoice")}</p>}
          {applicants.length === 0 && <p className="text-[15px] text-ink-2">{t("deal.noOffers")}</p>}
          {applicants.length > 0 && pickAt !== null && (
            <p className="self-start rounded-full bg-fill px-3 py-1 text-sm font-medium">
              <Countdown until={pickAt} serverNow={serverNow} template={t("deal.autoPickIn")} />
            </p>
          )}
          {applicants.map((o, i) => {
            const pp = person(people.get(o.helperId), t("deal.newHelper"));
            const km = p.ranked?.find((r) => r.helperId === o.helperId)?.distanceKm ?? null;
            const agreed = o.price ?? deal.postedFee; // what choosing this helper costs
            const waiting = o.proposedBy === "customer" && o.price !== null; // my counter, their turn
            const priceLine =
              o.price === null
                ? t("price.takesYours", { amount: fmtMoney(deal.postedFee) })
                : waiting
                  ? t("price.yourCounterWaiting", { amount: fmtMoney(o.price) })
                  : t("price.asks", { amount: fmtMoney(o.price) });
            return (
              <OfferCard
                key={o.helperId}
                person={pp}
                organization={o.orgId ? p.organizations?.get(o.orgId) : undefined}
                href={`/helpers/${o.helperId}`}
                badge={i === 0 && applicants.length > 1 ? t("deal.recommended") : undefined}
                note={[priceLine, km !== null ? t("job.away", { km: km.toFixed(1) }) : null, o.note].filter(Boolean).join(" · ")}
                t={t}
                action={
                  <div className="flex flex-col gap-2">
                  {/* talk before choosing: each applicant has their own chat and call */}
                  <ContactRow dealId={deal.id} withHelper={o.helperId} unread={p.applicantUnread?.get(o.helperId) ?? 0} canCall={callsEnabled()} t={t} />
                  {care && p.firstAid?.has(o.helperId) && <p className="self-start rounded-full bg-held-bg px-3 py-1 text-[13px] font-medium text-held">🩹 {t("care.firstAidBadge")}</p>}
                  {p.applicantBadges?.get(o.helperId) && <BadgeChips badges={p.applicantBadges.get(o.helperId) as HelperBadges & { record: OnTime }} t={t} />}
                  {p.needsCall && !p.careCalls?.has(o.helperId) && (
                    <p className="rounded-input bg-warn-bg px-3 py-2 text-[13px] text-warn">
                      {!callsEnabled()
                        ? t("call.requiredUnavailable")
                        : care
                          ? t("care.callFirst", { seconds: p.careCallSeconds ?? 30 })
                          : t("conditions.callFirst", { seconds: p.careCallSeconds ?? 30 })}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    {!waiting && (!p.needsCall || p.careCalls?.has(o.helperId)) && (
                      <ConfirmSheet
                        action={p.action}
                        fields={{ ...fields, intent: "choose", helperId: o.helperId }}
                        trigger={t("price.chooseAt", { amount: fmtMoney(agreed) })}
                        triggerClass={btn.small}
                        title={t("deal.chooseTitle", { name: pp.name })}
                        body={[
                          o.price !== null ? t("price.chooseCounter", { name: pp.name, amount: fmtMoney(o.price), posted: fmtMoney(deal.postedFee) }) : null,
                          t("deal.chooseBody", { name: pp.name, fee: fmtMoney(deal.cancelFee) }),
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        confirmLabel={t("deal.choose")}
                      >
                        {care && !p.careKnown?.has(o.helperId) && (
                          <label className="flex items-start gap-3 rounded-input bg-warn-bg p-3 text-[15px]">
                            <input type="checkbox" name="familyHome" required className="mt-1 h-5 w-5" />
                            <span>{t("care.meetFirst", { name: pp.name })}</span>
                          </label>
                        )}
                      </ConfirmSheet>
                    )}
                    <ConfirmSheet
                      action={p.action}
                      fields={{ ...fields, intent: "counter", helperId: o.helperId }}
                      trigger={waiting ? t("price.changeCounter") : t("price.offerPrice")}
                      triggerClass={`${btn.text} min-h-10 px-1 text-brand-ink`}
                      title={t("price.offerTitle", { name: pp.name })}
                      body={t("price.offerBody", { name: pp.name })}
                      confirmLabel={t("price.counterSend")}
                    >
                      <label className={fieldLabel}>
                        {t("job.quotePrice")}
                        <input name="price" inputMode="numeric" defaultValue={String(agreed)} className={`${field} text-[20px] font-bold tabular-nums`} required />
                      </label>
                    </ConfirmSheet>
                  </div>
                  </div>
                }
              />
            );
          })}
          {/* change the posted price for everyone; helpers who already said yes keep their price */}
          <ConfirmSheet
            action={p.action}
            fields={{ ...fields, intent: "set_price" }}
            trigger={t("price.changePosted", { amount: fmtMoney(deal.postedFee) })}
            triggerClass={`${btn.secondary} w-full`}
            title={t("price.changePostedTitle")}
            body={t("price.changePostedBody")}
            confirmLabel={t("price.changePostedGo")}
          >
            <label className={fieldLabel}>
              {t("price.yourPrice")}
              <input name="price" inputMode="numeric" defaultValue={String(deal.postedFee)} className={`${field} text-[20px] font-bold tabular-nums`} required />
            </label>
          </ConfirmSheet>
        </section>
      )}

      {p.workPhotos}

      {p.proofs && p.proofs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-bold">{t("proof.title")}</h2>
          <ProofGallery proofs={p.proofs} t={t} />
        </section>
      )}

      {topUpPending && deal.receiptAmount !== null && (
        <section className="flex flex-col gap-2 rounded-card border-2 border-warn bg-warn-bg p-4" aria-live="polite">
          <h2 className="text-lg font-bold text-ink">{t("deal.topUp.title", { amount: fmtMoney(topUpPending.amount) })}</h2>
          {isCustomer ? (
            <>
              <p className="text-[15px] text-ink">
                {t("deal.topUp.body", {
                  helper: helperName,
                  receipt: fmtMoney(deal.receiptAmount),
                  budget: fmtMoney(deal.itemBudget),
                })}
              </p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[15px] tabular-nums">
                <dt className="text-ink-2">{t("deal.topUp.receipt")}</dt>
                <dd className="text-right">{fmtMoney(deal.receiptAmount)}</dd>
                <dt className="text-ink-2">{t("deal.topUp.budget")}</dt>
                <dd className="text-right">{fmtMoney(deal.itemBudget)}</dd>
                <dt className="border-t border-warn/30 pt-1 font-semibold">{t("deal.topUp.extra")}</dt>
                <dd className="border-t border-warn/30 pt-1 text-right font-bold">{fmtMoney(topUpPending.amount)}</dd>
              </dl>
            </>
          ) : (
            <p className="text-[15px] text-ink">{t("deal.topUp.waiting", { amount: fmtMoney(topUpPending.amount) })}</p>
          )}
        </section>
      )}

      {deal.receiptAmount !== null && deal.itemBudget > 0 && !topUpPending && (
        <Card>
          <p className="font-semibold">{t("deal.receipt", { amount: fmtMoney(deal.receiptAmount) })}</p>
          {deal.receiptAmount <= deal.itemBudget && (
            <p className="text-sm text-held">{t("deal.receiptWithin", { budget: fmtMoney(deal.itemBudget) })}</p>
          )}
          {topUp?.status === "paid" && <p className="text-sm text-held">{t("deal.topUp.paid", { amount: fmtMoney(topUp.amount) })}</p>}
        </Card>
      )}
      {topUp?.status === "declined" && deal.status === "in_progress" && (
        <Card>
          <p className="text-[15px]">{t("deal.topUp.declined")}</p>
        </Card>
      )}

      {p.handoverCode && (
        <section className="flex flex-col items-center gap-1 rounded-card bg-bg p-4 text-center shadow-card" aria-label={t("conditions.codeTitle")}>
          <h2 className="font-bold">🔢 {t("conditions.codeTitle")}</h2>
          <p className="text-[40px] font-extrabold tracking-[0.3em] tabular-nums text-brand-ink">{p.handoverCode}</p>
          <p className="text-sm text-ink-2">{t("conditions.codeSub")}</p>
        </section>
      )}
      {money}
      {isCustomer && p.directPay && (
        <DirectPayCustomerCard dealId={deal.id} payeeName={payeeName} state={p.directPay.state} account={p.directPay.account} receipt={deal.receiptAmount} action={p.action} t={t} />
      )}

      <DetailSection label={t("job.whenLabel")}>
        <p className="text-[18px] font-bold">{when}</p>
      </DetailSection>

      <DetailSection label={t("job.placeLabel")}>
        <p className="whitespace-pre-line pb-1 text-[16px]">{deal.description}</p>
        <ConditionChips variety={deal.details.variety} require={deal.details.require} t={t} />
        {p.photosEditable ? <TaskPhotoManager dealId={deal.id} photos={p.photos ?? []} /> : p.photos && <TaskPhotoGrid photos={p.photos} t={t} />}
        <div className="flex flex-col gap-2">
          {deal.pickupAddress && <AddressBox icon="●" label={t("task.pickup")} address={deal.pickupAddress} />}
          <AddressBox
            icon="↘"
            label={deal.pickupAddress || deal.pickupLocation ? t("task.drop") : t("task.where")}
            address={deal.address}
            directionsUrl={deal.location ? googlePlaceUrl(deal.location) : undefined}
            directionsLabel={t("map.openShort")}
          />
        </div>
        {detailBits.length > 0 && <p className="text-[15px] text-ink-2">{detailBits.join(" · ")}</p>}
        {deal.details.note && <p className="rounded-input bg-fill p-3 text-[15px]">{deal.details.note}</p>}
      </DetailSection>

      <DetailSection label={t("deal.timeline")}>
        <ol className="flex flex-col gap-3 pt-1">
          {[...events].reverse().map((e, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-24 flex-none text-ink-2 tabular-nums">{fmtDateTime(e.at, locale)}</span>
              <span>{describeEvent(e.code, e.data, t, name)}</span>
            </li>
          ))}
        </ol>
      </DetailSection>

      {(primary || secondary.length > 0) && (
        <PrimaryBar>
          {primary}
          {secondary.length > 0 && <div className="flex flex-wrap justify-center gap-1">{secondary}</div>}
        </PrimaryBar>
      )}
    </>
  );
}
