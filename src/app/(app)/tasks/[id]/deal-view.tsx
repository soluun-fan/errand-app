import { CategoryIcon } from "@/components/category-icon";
import { BadgeChips, ConditionChips } from "@/components/conditions";
import { Countdown } from "@/components/countdown";
import { CustomerTaskMap } from "@/components/customer-task-map";
import { AddressBox, DetailSection, DetailTitle } from "@/components/detail";
import { DirectPayCustomerCard } from "@/components/direct-pay-card";
import { Ico } from "@/components/icon";
import { InlineAction } from "@/components/inline-action";
import { OfferCard, type OfferPerson } from "@/components/offer-card";
import { PriceChangeCard } from "@/components/price-change-card";
import { ProofGallery } from "@/components/proof-gallery";
import { ConfirmSheet } from "@/components/sheet";
import { StatusBadge } from "@/components/status-badge";
import { StepTracker } from "@/components/step-tracker";
import { TaskPhotoGrid } from "@/components/task-photo-grid";
import { TaskPhotoManager } from "@/components/task-photo-manager";
import { TimelineList } from "@/components/timeline-list";
import { Card, FlowHeader, HeldBadge, Note, PrimaryBar, btn, chipClass, field, fieldLabel } from "@/components/ui";
import { recommendReasons } from "@/lib/dispatch/plan";
import type { T } from "@/i18n";
import type { OnTime } from "@/lib/badges";
import { callParty, callsEnabled } from "@/lib/calls";
import type { PublicProfile } from "@/lib/deals/queries";
import type { HelperBadges } from "@/lib/engine";
import { arriveBy, autoPickAt, categoryTrust, helperLate, liveOffers, ruleOf } from "@/lib/engine";
import { fmtClock, fmtDateTime, fmtMoney } from "@/lib/format";
import { describeEvent } from "@/lib/labels";
import { googlePlaceUrl } from "@/lib/maps";
import { Hash, HeartPulse, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { MockQr } from "./mock-qr";
import { PaySheet } from "./pay-sheet";

import { customerActions } from "./deal-actions";
import { DealMoney } from "./deal-money";
import { DealStatusLine } from "./deal-status-line";
import type { DealViewProps } from "./deal-view-types";
export type { DealViewProps } from "./deal-view-types";

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
export function ContactRow({
  dealId,
  unread,
  canCall,
  t,
  withHelper = null,
}: {
  dealId: string;
  unread: number;
  canCall: boolean;
  t: T;
  withHelper?: string | null;
}) {
  // the customer talking to one applicant (before choosing) opens that applicant's conversation
  const href = withHelper ? `/chat/${dealId}?with=${withHelper}` : `/chat/${dealId}`;
  return (
    <div className={`grid gap-2 ${canCall ? "grid-cols-2" : "grid-cols-1"}`}>
      {canCall && (
        <Link href={href} className={`${btn.secondary} w-full`}>
          <Ico as={Phone} /> {t("call.voice")}
        </Link>
      )}
      <Link href={href} className={`${btn.small} relative w-full`}>
        <Ico as={MessageCircle} /> {t("chat.open")}
        {unread > 0 && (
          <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">{t("chat.unread", { n: unread })}</span>
        )}
      </Link>
    </div>
  );
}

export function DealView(p: DealViewProps) {
  const { deal, events, people, t, locale, serverNow } = p;
  const isCustomer = deal.customerId === p.viewerId;
  const care = categoryTrust(deal.category) === "care";
  const name = (uid: unknown) =>
    typeof uid === "string" ? (people.get(uid)?.name ?? p.organizations?.get(uid)?.name ?? t("deal.newHelper")) : "—";
  const helperName = deal.helperId ? name(deal.helperId) : "";
  const payeeName = deal.payeeOrgId ? (p.organizations?.get(deal.payeeOrgId)?.name ?? t("org.title")) : helperName;
  const fields = { dealId: deal.id };
  // Live applicants, best first (the page ranks them; unranked ones keep their order).
  const rankOf = (h: string) => p.ranked?.findIndex((r) => r.helperId === h) ?? -1;
  const applicants = liveOffers(deal, serverNow)
    .filter((o) => !p.ranked || p.ranked.some((r) => r.helperId === o.helperId))
    .sort((a, b) => {
      const ra = rankOf(a.helperId);
      const rb = rankOf(b.helperId);
      return (ra < 0 ? 1e9 : ra) - (rb < 0 ? 1e9 : rb);
    });
  // the recommendation is the best-ranked applicant; the customer may sort by distance or rating instead
  const recommendedId = applicants.length > 1 ? applicants[0].helperId : null;
  const why = recommendReasons(p.ranked ?? []).map((r) => t(`deal.why.${r}`));
  const sortBy = p.applicantSort ?? "recommended";
  const rankedOf = (h: string) => p.ranked?.find((r) => r.helperId === h);
  if (sortBy === "near") applicants.sort((a, b) => (rankedOf(a.helperId)?.distanceKm ?? 1e9) - (rankedOf(b.helperId)?.distanceKm ?? 1e9));
  if (sortBy === "rating") applicants.sort((a, b) => (rankedOf(b.helperId)?.rating ?? 0) - (rankedOf(a.helperId)?.rating ?? 0));
  const pickAt = autoPickAt(deal, serverNow);
  const topUp = deal.topUp;
  const topUpPending = deal.status === "in_progress" && topUp?.status === "pending" ? topUp : null;
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
  const duration =
    deal.details.minutes >= 60 ? t("price.hours", { n: deal.details.minutes / 60 }) : t("price.min", { n: deal.details.minutes });
  const when = deal.scheduledAt
    ? t("job.startsAt", { time: fmtDateTime(deal.scheduledAt, locale), dur: duration })
    : deal.mode === "schedule" && deal.matchBy
      ? t("job.flexibleFor", { time: fmtDateTime(deal.matchBy, locale), dur: duration }) // not urgent: open until then
      : t("job.nowFor", { dur: duration });
  const waiting = ["awaiting_payment", "open", "matched", "in_progress", "check", "disputed"].includes(deal.status);
  const showMap = waiting && Boolean(deal.location || deal.pickupLocation || p.helperLocation);

  const { primary, secondary } = customerActions(p, helperName, payeeName);

  return (
    <>
      {!showMap && <FlowHeader href="/" label={t("common.back")} />}
      {showMap && (
        <CustomerTaskMap
          destination={deal.location}
          pickup={deal.pickupLocation}
          address={deal.address}
          pickupAddress={deal.pickupAddress}
          helperName={helperName}
          tracking={p.helperLocation}
          serverNow={p.serverNow}
        />
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
        overlap={showMap}
      >
        <StepTracker status={deal.status} events={events} t={t} />
        <div className="text-[16px] text-ink">
          <DealStatusLine p={p} helperName={helperName} payeeName={payeeName} />
        </div>
        {deal.heldAmount > 0 && (
          <HeldBadge>
            {direct
              ? t("direct.badge", { amount: fmtMoney(deal.heldAmount) })
              : t("money.heldBadge", { amount: fmtMoney(deal.heldAmount) })}
          </HeldBadge>
        )}
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
          action={
            p.chat ? (
              <ContactRow dealId={deal.id} unread={p.chat.unread} canCall={callsEnabled() && callParty(deal, p.viewerId) !== null} t={t} />
            ) : undefined
          }
        />
      )}

      {deal.status === "matched" && arriveBy(deal) !== null && (
        <div className="flex flex-col gap-2 px-5 pt-2">
          <Note tone={helperLate(deal, serverNow) ? "warn" : "info"}>
            {helperLate(deal, serverNow)
              ? t("standards.customerLate", { helper: helperName, time: fmtClock(arriveBy(deal) as number) })
              : t("standards.customerArriveBy", { helper: helperName, time: fmtClock(arriveBy(deal) as number) })}
            {deal.enRouteAt && !helperLate(deal, serverNow) ? ` ${t("noShow.customerEnRoute", { helper: helperName })}` : ""}
          </Note>
          {(deal.arriveExtendMinutes ?? 0) > 0 && !helperLate(deal, serverNow) && (
            <Note tone="grey">{t("noShow.customerDelay", { helper: helperName, n: deal.arriveExtendMinutes ?? 0 })}</Note>
          )}
        </div>
      )}
      {isCustomer && deal.status === "in_progress" && deal.absentAt && (
        <div className="flex flex-col gap-2 px-5 pt-2">
          <Note tone="bad">
            {t("noShow.customerAsked", {
              helper: helperName,
              time: fmtClock(deal.absentAt + ruleOf(deal, "absentGraceMinutes") * 60_000),
              fee: fmtMoney(deal.cancelFee),
            })}
          </Note>
          <InlineAction
            action={p.action}
            fields={{ ...fields, intent: "customer_present" }}
            label={t("noShow.imHere")}
            className={`${btn.primary} w-full`}
          />
        </div>
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
          {applicants.length > 1 && (
            <nav aria-label={t("deal.sortLabel")} className="flex flex-wrap gap-2">
              {(["recommended", "near", "rating"] as const).map((s) => (
                <Link
                  key={s}
                  href={s === "recommended" ? `/tasks/${deal.id}` : `/tasks/${deal.id}?sort=${s}`}
                  scroll={false}
                  aria-current={sortBy === s ? "page" : undefined}
                  className={chipClass(sortBy === s)}
                >
                  {t(`deal.sort.${s}`)}
                </Link>
              ))}
            </nav>
          )}
          {applicants.length > 0 && pickAt !== null && (
            <p className="self-start rounded-full bg-fill px-3 py-1 text-sm font-medium">
              <Countdown until={pickAt} serverNow={serverNow} template={t("deal.autoPickIn")} />
            </p>
          )}
          {applicants.map((o) => {
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
                badge={o.helperId === recommendedId ? t("deal.recommended") : undefined}
                badgeNote={o.helperId === recommendedId && why.length ? why.join(" · ") : undefined}
                note={[priceLine, km !== null ? t("job.away", { km: km.toFixed(1) }) : null, o.note].filter(Boolean).join(" · ")}
                t={t}
                action={
                  <div className="flex flex-col gap-2">
                    {/* talk before choosing: each applicant has their own chat and call */}
                    <ContactRow
                      dealId={deal.id}
                      withHelper={o.helperId}
                      unread={p.applicantUnread?.get(o.helperId) ?? 0}
                      canCall={callsEnabled()}
                      t={t}
                    />
                    {care && p.firstAid?.has(o.helperId) && (
                      <p className="self-start rounded-full bg-held-bg px-3 py-1 text-[13px] font-medium text-held">
                        <Ico as={HeartPulse} size={14} /> {t("care.firstAidBadge")}
                      </p>
                    )}
                    {p.applicantBadges?.get(o.helperId) && (
                      <BadgeChips badges={p.applicantBadges.get(o.helperId) as HelperBadges & { record: OnTime }} t={t} />
                    )}
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
                            o.price !== null
                              ? t("price.chooseCounter", { name: pp.name, amount: fmtMoney(o.price), posted: fmtMoney(deal.postedFee) })
                              : null,
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
                          <input
                            name="price"
                            inputMode="numeric"
                            defaultValue={String(agreed)}
                            className={`${field} text-[20px] font-bold tabular-nums`}
                            required
                          />
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
              <input
                name="price"
                inputMode="numeric"
                defaultValue={String(deal.postedFee)}
                className={`${field} text-[20px] font-bold tabular-nums`}
                required
              />
            </label>
          </ConfirmSheet>
        </section>
      )}

      {isCustomer &&
        deal.status === "open" &&
        p.nudgeAfterMinutes !== undefined &&
        liveOffers(deal, p.serverNow).length === 0 &&
        p.serverNow - deal.createdAt >= p.nudgeAfterMinutes * 60_000 && (
          <section className="flex flex-col gap-3 rounded-card bg-warn-bg p-4">
            <h2 className="font-bold">{t("nudge.title")}</h2>
            <p className="text-[15px]">{t("nudge.body", { amount: fmtMoney(deal.postedFee) })}</p>
            <div className="grid grid-cols-3 gap-2">
              {[500, 1000, 1500].map((step) => (
                <ConfirmSheet
                  key={step}
                  action={p.action}
                  fields={{ ...fields, intent: "set_price", price: String(deal.postedFee + step), raise: "1" }}
                  trigger={`+${fmtMoney(step)}`}
                  triggerClass={btn.secondary}
                  title={t("nudge.confirmTitle", { amount: fmtMoney(deal.postedFee + step) })}
                  body={t("nudge.confirmBody")}
                  confirmLabel={t("nudge.confirmGo")}
                />
              ))}
            </div>
            <ConfirmSheet
              action={p.action}
              fields={{ ...fields, intent: "set_price", raise: "1" }}
              trigger={t("nudge.other")}
              triggerClass={btn.text}
              title={t("price.changePostedTitle")}
              body={t("nudge.confirmBody")}
              confirmLabel={t("nudge.confirmGo")}
            >
              <label className={fieldLabel}>
                {t("price.yourPrice")}
                <input
                  name="price"
                  inputMode="numeric"
                  defaultValue={String(deal.postedFee + 2000)}
                  className={`${field} text-[20px] font-bold tabular-nums`}
                  required
                />
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
        <section
          className="flex flex-col items-center gap-1 rounded-card bg-bg p-4 text-center shadow-card"
          aria-label={t("conditions.codeTitle")}
        >
          <h2 className="font-bold">
            <Ico as={Hash} /> {t("conditions.codeTitle")}
          </h2>
          <p className="text-[40px] font-extrabold tracking-[0.3em] tabular-nums text-brand-ink">{p.handoverCode}</p>
          <p className="text-sm text-ink-2">{t("conditions.codeSub")}</p>
        </section>
      )}
      <DealMoney deal={deal} payeeName={payeeName} t={t} />
      {isCustomer && p.directPay && (
        <DirectPayCustomerCard
          dealId={deal.id}
          payeeName={payeeName}
          state={p.directPay.state}
          account={p.directPay.account}
          receipt={deal.receiptAmount}
          action={p.action}
          t={t}
        />
      )}

      <DetailSection label={t("job.whenLabel")}>
        <p className="text-[18px] font-bold">{when}</p>
      </DetailSection>

      <DetailSection label={t("job.placeLabel")}>
        <p className="whitespace-pre-line pb-1 text-[16px]">{deal.description}</p>
        <ConditionChips variety={deal.details.variety} require={deal.details.require} t={t} />
        {p.photosEditable ? (
          <TaskPhotoManager dealId={deal.id} photos={p.photos ?? []} />
        ) : (
          p.photos && <TaskPhotoGrid photos={p.photos} t={t} />
        )}
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
        <TimelineList
          events={[...events].reverse()}
          describe={(e) => describeEvent(e.code, e.data, t, name)}
          locale={locale}
          moreLabel={t("web.seeAll")}
        />
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
