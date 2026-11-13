import Link from "next/link";
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
import { amountDue, errandSplit, type ErrandDeal } from "@/lib/engine";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { CATEGORY_ICON, DISPUTE_REASONS, RATING_TAGS, describeEvent } from "@/lib/labels";
import { MockQr } from "./mock-qr";
import { PaySheet } from "./pay-sheet";

export interface DealViewProps {
  deal: ErrandDeal;
  events: TimelineItem[];
  people: Map<string, PublicProfile>;
  viewerId: string;
  serverNow: number;
  t: T;
  locale: Locale;
  /** Stars the viewer already gave, or null. */
  rated: number | null;
  autoOpenPay: boolean;
  mockPay: boolean;
  action: FormAction;
  /** Dispatch progress while the task is open (how many helpers were notified). */
  dispatch?: { notified: number } | null;
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
export function DealView(p: DealViewProps) {
  const { deal, events, people, t, locale, serverNow } = p;
  const isCustomer = deal.customerId === p.viewerId;
  const name = (uid: unknown) => (typeof uid === "string" ? (people.get(uid)?.name ?? t("deal.newHelper")) : "—");
  const helperName = deal.helperId ? name(deal.helperId) : "";
  const split = errandSplit({
    fee: deal.fee,
    itemBudget: deal.itemBudget,
    receipt: deal.receiptAmount,
    serviceFee: deal.serviceFee,
    commissionBps: deal.commissionBps,
  });
  const fields = { dealId: deal.id };
  const topUp = deal.topUp;
  const topUpPending = deal.status === "in_progress" && topUp?.status === "pending" ? topUp : null;
  const againLink = (cls: string) => (
    <Link key="again" href={`/post?again=${deal.id}`} className={cls}>
      {t("deal.postAgain")}
    </Link>
  );
  const cancelFeePaid = events.find((e) => e.code === "cancel_fee_paid");
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
        <Countdown until={deal.payBy} serverNow={serverNow} template={t("deal.line.awaiting_payment", { helper: helperName, time: "{time}" })} />
      ) : null;
      break;
    case "open":
      line = (
        <>
          {deal.mode === "now"
            ? p.dispatch?.notified
              ? t("deal.line.openNow", { n: p.dispatch.notified })
              : t("deal.line.openNowStart")
            : t("deal.line.openSchedule", { offers: deal.offers.length, max: deal.maxApplicants })}{" "}
          {deal.matchBy && t("deal.line.noMatchBy", { when: fmtDateTime(deal.matchBy, locale) })}
        </>
      );
      break;
    case "matched":
      line = t("deal.line.matched", { helper: helperName });
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
      line = t("deal.line.disputed");
      break;
    case "released":
      line = split.refund > 0 ? t("deal.line.releasedRefund", { amount: fmtMoney(split.refund) }) : t("deal.line.released", { helper: helperName });
      break;
    case "refunded":
      line = t("deal.line.refunded", { amount: fmtMoney(amountDue(deal)) });
      break;
    case "cancelled":
      line = cancelFeePaid
        ? t("deal.line.cancelledFee", { fee: fmtMoney(Number(cancelFeePaid.data.amount ?? 0)) })
        : t("deal.line.cancelled");
      break;
    case "expired":
      line = deal.paymentRef ? t("deal.line.expiredNoHelper", { amount: fmtMoney(amountDue(deal)) }) : t("deal.line.expiredUnpaid");
      break;
  }
  const waiting = ["awaiting_payment", "open", "matched", "in_progress", "check", "disputed"].includes(deal.status);

  /* ---------- money: where it is now ---------- */
  let money: ReactNode;
  if (["check", "disputed", "released"].includes(deal.status)) {
    const rows: MoneyRow[] = [{ label: t("money.toHelperFee", { pct: deal.commissionBps / 100 }), amount: split.helperFeeNet }];
    if (deal.itemBudget > 0) {
      rows.push({ label: t("money.toHelperItems"), amount: split.spent });
      rows.push({ label: t("money.backToYou"), amount: split.refund });
    }
    rows.push({ label: t("money.platform"), amount: split.platform, muted: true });
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
                ? t("deal.confirmBodyRefund", { helper: helperName, net: fmtMoney(split.helperNet), refund: fmtMoney(split.refund) })
                : t("deal.confirmBody", { helper: helperName, net: fmtMoney(split.helperNet) })
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
            <p className="rounded-input bg-warn-bg p-3 text-sm text-warn">{t("dispute.what")}</p>
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
      <FlowHeader href="/history" label={t("common.back")} />

      {/* status first */}
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink-2">
              <span aria-hidden>{CATEGORY_ICON[deal.category]}</span> {t(`category.${deal.category}`)} ·{" "}
              {deal.mode === "now" ? t("deal.now") : t("deal.scheduledFor", { when: deal.scheduledAt ? fmtDateTime(deal.scheduledAt, locale) : "" })}
            </p>
            <h1 className="mt-0.5 text-xl font-bold leading-snug">{deal.title}</h1>
          </div>
          <StatusBadge status={deal.status} t={t} />
        </div>
        <StepTracker status={deal.status} events={events} t={t} />
        <div className="text-[16px] text-ink">{line}</div>
        {deal.heldAmount > 0 && <HeldBadge>{t("money.heldBadge", { amount: fmtMoney(deal.heldAmount) })}</HeldBadge>}
        {p.rated !== null && <p className="text-sm text-ink-2">{t("deal.rated", { stars: p.rated })}</p>}
        {waiting && (
          <Link href="/help" className="self-start text-[15px] font-medium text-ink underline underline-offset-4">
            {t("common.needHelp")}
          </Link>
        )}
      </Card>

      {deal.helperId && (
        <OfferCard person={person(people.get(deal.helperId), helperName)} t={t} />
      )}

      {deal.status === "open" && deal.mode === "schedule" && isCustomer && (
        <section className="flex flex-col gap-2">
          <h2 className="font-bold">{t("deal.offers", { n: deal.offers.length, max: deal.maxApplicants })}</h2>
          {deal.offers.length === 0 && <p className="text-[15px] text-ink-2">{t("deal.noOffers")}</p>}
          {deal.offers.map((o) => {
            const pp = person(people.get(o.helperId), t("deal.newHelper"));
            return (
              <OfferCard
                key={o.helperId}
                person={pp}
                note={[o.price !== null ? fmtMoney(o.price) : null, o.note].filter(Boolean).join(" · ")}
                t={t}
                action={
                  <ConfirmSheet
                    action={p.action}
                    fields={{ ...fields, intent: "choose", helperId: o.helperId }}
                    trigger={t("deal.choose")}
                    triggerClass={btn.small}
                    title={t("deal.chooseTitle", { name: pp.name })}
                    body={t("deal.chooseBody", { name: pp.name, fee: fmtMoney(deal.cancelFee) })}
                    confirmLabel={t("deal.choose")}
                  />
                }
              />
            );
          })}
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

      {money}

      <Card>
        <p className="whitespace-pre-line text-[16px]">{deal.description}</p>
        {deal.pickupAddress && <p className="text-[15px] text-ink-2">● {t("deal.pickupAt", { place: deal.pickupAddress })}</p>}
        <p className="text-[15px] text-ink-2">↘ {deal.address}</p>
        {detailBits.length > 0 && <p className="text-[15px] text-ink-2">{detailBits.join(" · ")}</p>}
        {deal.details.note && <p className="rounded-input bg-fill p-2.5 text-[15px]">{deal.details.note}</p>}
      </Card>

      <Card>
        <h2 className="font-bold">{t("deal.timeline")}</h2>
        <ol className="flex flex-col gap-3">
          {[...events].reverse().map((e, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-24 flex-none text-ink-2 tabular-nums">{fmtDateTime(e.at, locale)}</span>
              <span>{describeEvent(e.code, e.data, t, name)}</span>
            </li>
          ))}
        </ol>
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
