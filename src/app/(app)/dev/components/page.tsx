import Link from "next/link";
import { notFound } from "next/navigation";
import { DealCard } from "@/components/deal-card";
import { MoneyBreakdown } from "@/components/money-breakdown";
import { OfferCard } from "@/components/offer-card";
import { StatusBadge } from "@/components/status-badge";
import { StepTracker } from "@/components/step-tracker";
import { MapPill, MapSlot } from "@/components/map-slot";
import { Card, EmptyState, HeldBadge, Note, Skeleton, btn, chipClass } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { devToolsEnabled } from "@/lib/dev";
import type { DealStatus } from "@/lib/engine";
import { DealView } from "../../tasks/[id]/deal-view";
import { galleryAction } from "./actions";
import { GalleryChoices } from "./gallery-choices";
import { FIXTURE_PEOPLE, FIXTURE_STATES, FX, buildFixture, type FixtureState } from "./fixtures";

const STATUSES: DealStatus[] = [
  "awaiting_payment",
  "open",
  "matched",
  "in_progress",
  "held",
  "check",
  "disputed",
  "released",
  "refunded",
  "cancelled",
  "expired",
];

/**
 * Component gallery (UI-FLOWS §15 steps 1 & 4): every building block, and the deal screen in
 * every state from fixtures. Use it to review copy in MN/EN (switch language in Profile).
 * Development only.
 */
export default async function Gallery({ searchParams }: PageProps<"/dev/components">) {
  if (!devToolsEnabled()) notFound();
  const [t, locale, sp] = await Promise.all([getT(), getLocale(), searchParams]);
  const now = Date.now();
  const state = FIXTURE_STATES.find((s) => s === sp.state) as FixtureState | undefined;

  if (state) {
    const { deal, events } = buildFixture(state, now);
    return (
      <>
        <Link href="/dev/components" className={btn.text}>
          ← Gallery · {state}
        </Link>
        <DealView
          deal={deal}
          events={events}
          people={FIXTURE_PEOPLE}
          viewerId={FX.customer}
          serverNow={now}
          t={t}
          locale={locale}
          rated={null}
          autoOpenPay={false}
          mockPay
          action={galleryAction}
        />
      </>
    );
  }

  const sample = buildFixture("check", now);
  return (
    <>
      <h1 className="text-2xl font-bold">UI gallery</h1>
      <Note tone="info">Dev only. Language follows Profile → Language. Sheets open but never change data.</Note>

      <Card>
        <h2 className="font-bold">Deal screen — every state</h2>
        <div className="flex flex-wrap gap-2">
          {FIXTURE_STATES.map((s) => (
            <Link key={s} href={`/dev/components?state=${s}`} className={chipClass(false)}>
              {s}
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-bold">Buttons</h2>
        <button className={btn.primary}>Primary · 46,000₮</button>
        <button className={btn.primary} disabled>
          Disabled primary
        </button>
        <div className="flex gap-2">
          <button className={btn.square}>←</button>
          <button className={`${btn.primary} flex-1`}>With square</button>
        </div>
        <button className={btn.secondary}>Secondary</button>
        <button className={btn.danger}>Danger</button>
        <div className="flex gap-2">
          <button className={btn.text}>Text</button>
          <button className={btn.textDanger}>Text danger</button>
          <button className={btn.primary} disabled>
            Disabled
          </button>
        </div>
      </Card>

      <Card>
        <h2 className="font-bold">StatusBadge</h2>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <StatusBadge key={s} status={s} t={t} />
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-bold">StepTracker</h2>
        {(["awaiting_payment", "open", "matched", "check", "released"] as const).map((s) => (
          <StepTracker key={s} status={s} events={s === "check" ? sample.events : []} t={t} />
        ))}
      </Card>

      <h2 className="font-bold">DealCard</h2>
      <DealCard deal={sample.deal} t={t} locale={locale} />

      <h2 className="font-bold">OfferCard</h2>
      <OfferCard
        person={{ name: "Bat-Erdene G.", rating: 4.9, ratingCount: 128, completed: 128, verified: true }}
        note="I can come at the posted time."
        t={t}
        action={<button className={btn.primary}>{t("deal.choose")}</button>}
      />

      <h2 className="font-bold">MoneyBreakdown</h2>
      <MoneyBreakdown
        rows={[
          { label: t("money.helperFee"), amount: 40000 },
          { label: t("money.itemBudget"), amount: 5000 },
          { label: t("money.serviceFee"), amount: 1000, muted: true },
        ]}
        total={{ label: t("money.totalHeld"), amount: 46000 }}
        caption={t("money.itemBudgetNote")}
      />

      <h2 className="font-bold">HeldBadge · MapSlot · choice cards</h2>
      <HeldBadge>{t("money.heldBadge", { amount: "46,000₮" })}</HeldBadge>
      <div className="-mx-5">
        <MapSlot className="h-48">
          <div className="absolute inset-x-0 top-[38%] flex justify-center">
            <MapPill>📍 Сүхбаатар, 1-р хороо ›</MapPill>
          </div>
        </MapSlot>
      </div>
      <GalleryChoices />

      <h2 className="font-bold">Notes</h2>
      {(["held", "warn", "bad", "info", "grey"] as const).map((tone) => (
        <Note key={tone} tone={tone}>
          {tone}: {t("money.heldAtBank")}
        </Note>
      ))}

      <h2 className="font-bold">EmptyState · Skeleton</h2>
      <Card>
        <EmptyState icon="📋" title={t("deal.empty")} body={t("deal.emptyBody")} action={<button className={btn.primary}>{t("deal.postTask")}</button>} />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20" />
      </Card>
    </>
  );
}
