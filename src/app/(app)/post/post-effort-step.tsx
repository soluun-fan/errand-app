"use client";

import { PriceDeltaCard, ToggleRow } from "@/components/choice";
import { Ico } from "@/components/icon";
import { Note, chipClass, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import {
  categoryConfig,
  categoryTrust,
  heldItemBudget,
  isNight,
  quoteFee,
  type EngineConfig,
  type ErrandDetails,
} from "@/lib/engine";
import { fmtMoney, toUbLocal } from "@/lib/format";
import { CalendarDays, DoorOpen, Hand, Receipt, Ruler, ShoppingBag, Weight, Wrench } from "lucide-react";

import type { Dispatch, SetStateAction } from "react";
import { DURATIONS, KM, digits, twoPlaces, type Draft } from "./post-draft";
export function PostEffortStep({
  d,
  setD,
  cfg,
  details,
  measuredKm,
  startsAt,
  now,
  travelMinutes,
  autoMinutes,
  quote,
}: {
  d: Draft;
  setD: Dispatch<SetStateAction<Draft>>;
  cfg: EngineConfig;
  details: ErrandDetails;
  measuredKm: number | null;
  startsAt: number;
  now: number;
  travelMinutes: number;
  autoMinutes: number;
  quote: ReturnType<typeof quoteFee>;
}) {
  const t = useT();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const twoPoint = twoPlaces(d);
  const isCarry = d.category === "carry";
  const care = categoryTrust(d.category) === "care";
  const buys = categoryConfig(d.category).items;
  const direct = cfg.payMode === "direct";
  const itemBudget = buys && d.buyForMe ? Number(digits(d.itemBudget) || 0) : 0;
  const stairs = quote.lines.find((l) => l.key === "stairs");
  const backLeg = quoteFee(d.category, { ...details, roundTrip: true }, cfg, startsAt).lines.find((l) => l.key === "roundTrip");
  const needTwo = quote.peopleRequired === 2;
  return (
    <>
      {twoPoint && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body font-medium text-ink-2">{t("task.distance")}</legend>
          {measuredKm !== null ? (
            <p className="rounded-input bg-fill px-4 py-3 text-lead font-medium">
              <Ico as={Ruler} /> {t("map.measured", { km: measuredKm.toFixed(1) })}
            </p>
          ) : (
            <>
              <div className="flex gap-2" role="radiogroup">
                {KM.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={d.km === k}
                    onClick={() => set("km", k)}
                    className={chipClass(d.km === k)}
                  >
                    ~{k} км
                  </button>
                ))}
              </div>
              <p className="text-small text-ink-2">{t("map.noPickupPin")}</p>
            </>
          )}
          <ToggleRow
            icon="↩"
            title={t("task.roundTrip")}
            sub={backLeg ? `${t("task.roundTripSub")} · +${fmtMoney(backLeg.amount)}` : t("task.roundTripSub")}
            checked={d.roundTrip}
            onChange={(v) => set("roundTrip", v)}
          />
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-body font-medium text-ink-2">{t("task.when")}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {(["now", "flexible", "today", "tomorrow", "pick"] as const).map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={d.when === w}
              onClick={() => set("when", w)}
              className={chipClass(d.when === w)}
            >
              {w === "pick" ? (
                <>
                  <Ico as={CalendarDays} size={16} />{" "}
                </>
              ) : (
                ""
              )}
              {w === "flexible"
                ? t("task.whenFlexible", { hours: Math.round(cfg.scheduleMatchWindowMinutes / 60) })
                : t(
                    w === "now"
                      ? "task.whenNow"
                      : w === "today"
                        ? "task.whenToday"
                        : w === "tomorrow"
                          ? "task.whenTomorrow"
                          : "task.whenPick",
                  )}
            </button>
          ))}
        </div>
        {d.when === "flexible" && (
          <Note tone="info">{t("task.whenFlexibleNote", { hours: Math.round(cfg.scheduleMatchWindowMinutes / 60) })}</Note>
        )}
        {(d.when === "today" || d.when === "tomorrow") && (
          <label className={fieldLabel}>
            {t("task.time")}
            <input type="time" className={field} value={d.time} onChange={(e) => set("time", e.target.value)} />
          </label>
        )}
        {d.when === "pick" && (
          <label className={fieldLabel}>
            {t("post.dateTime")}
            <input
              type="datetime-local"
              className={field}
              value={d.date}
              min={toUbLocal(now + 30 * 60_000)}
              onChange={(e) => set("date", e.target.value)}
            />
          </label>
        )}
        {isNight(startsAt, cfg) && <Note tone="warn">{t("price.nightNote", { amount: fmtMoney(cfg.nightFee) })}</Note>}
      </fieldset>
      {/* Effort: what the price is built from — works for any job, even an unusual one */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-body font-medium text-ink-2">{t("price.howLong")}</legend>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5" role="radiogroup">
          {DURATIONS.filter((m) => !care || m <= cfg.careMaxMinutes).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={details.minutes === m}
              onClick={() => set("minutes", m)}
              className={chipClass(details.minutes === m)}
            >
              {m < 60 ? t("price.min", { n: m }) : t("price.hours", { n: m / 60 })}
            </button>
          ))}
        </div>
        <p className="text-small text-ink-2">{t("price.howLongHelp", { amount: fmtMoney(cfg.perHalfHour), min: cfg.includedMinutes })}</p>
        {travelMinutes > 0 && (
          <p className="text-small text-ink-2">
            {t(d.roundTrip ? "price.travelBoth" : "price.travelOne", { min: travelMinutes })}
            {d.minutes !== null && d.minutes < autoMinutes ? ` ${t("price.travelShort", { min: autoMinutes })}` : ""}
          </p>
        )}
        {care && (
          <Note tone="info">
            {t("care.pilotHours", { from: cfg.careDayStartHour, to: cfg.careDayEndHour, hours: cfg.careMaxMinutes / 60 })}
          </Note>
        )}
      </fieldset>
      <details className="group rounded-card bg-bg shadow-card px-4" open={d.heavy || d.tools || undefined}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-body font-medium text-ink-2">
          {t("addressEntry.extraOptions")}
          <span aria-hidden className="transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <p className="pb-3 text-small text-ink-2">{t("addressEntry.extraHelp")}</p>
        <div className="mb-4 flex flex-col gap-3">
          <ToggleRow
            icon={<Weight aria-hidden size={24} />}
            title={t("task.heavy")}
            sub={t("price.heavySub", { amount: fmtMoney(cfg.heavyFee) })}
            checked={d.heavy}
            onChange={(v) => set("heavy", v)}
          />
          <ToggleRow
            icon={<Wrench aria-hidden size={24} />}
            title={t("price.tools")}
            sub={t("price.toolsSub", { amount: fmtMoney(cfg.toolsFee) })}
            checked={d.tools}
            onChange={(v) => set("tools", v)}
          />
        </div>
      </details>
      {isCarry && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-body font-medium text-ink-2">{t("task.carryHow")}</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            <PriceDeltaCard
              selected={d.carryByHelper}
              onSelect={() => set("carryByHelper", true)}
              icon={<Hand aria-hidden size={24} />}
              title={t("task.carryHelper")}
              sub={t("task.carryHelperSub")}
              delta={stairs ? `+${fmtMoney(stairs.amount)}` : t("task.perFloor", { amount: fmtMoney(cfg.carryPerFloor) })}
            />
            <PriceDeltaCard
              selected={!d.carryByHelper}
              onSelect={() => set("carryByHelper", false)}
              icon={<DoorOpen aria-hidden size={24} />}
              title={t("task.carrySelf")}
              sub={t("task.carrySelfSub")}
              delta={`+${fmtMoney(0)}`}
              free
            />
          </div>
          {needTwo && <Note tone="warn">{t("task.needTwo")}</Note>}
        </fieldset>
      )}
      {buys && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-body font-medium text-ink-2">{t("task.buyTitle")}</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            <PriceDeltaCard
              selected={d.buyForMe}
              onSelect={() => set("buyForMe", true)}
              icon={<Receipt aria-hidden size={24} />}
              title={t("task.buyForMe")}
              sub={t("task.buyForMeSub")}
            />
            <PriceDeltaCard
              selected={!d.buyForMe}
              onSelect={() => set("buyForMe", false)}
              icon={<ShoppingBag aria-hidden size={24} />}
              title={t("task.buySelf")}
              sub={t("task.buySelfSub")}
              delta={`+${fmtMoney(0)}`}
              free
            />
          </div>
          {d.buyForMe && (
            <label className={fieldLabel}>
              {t("task.budget")}
              <input
                className={`${field} text-title-lg font-bold tabular-nums`}
                inputMode="numeric"
                value={d.itemBudget}
                placeholder="20,000"
                onChange={(e) => set("itemBudget", digits(e.target.value))}
              />
              <span className="text-small font-normal">{t("post.itemsHelp")}</span>
            </label>
          )}
          {/* the +10% buffer is only meaningful when the money is held */}
          {d.buyForMe && !direct && (
            <ToggleRow
              icon={<Receipt aria-hidden size={24} />}
              title={t("task.buffer")}
              sub={
                itemBudget > 0
                  ? t("task.bufferSub", { amount: fmtMoney(heldItemBudget(itemBudget, true, cfg) - itemBudget) })
                  : t("task.bufferSubEmpty")
              }
              checked={d.budgetBuffer}
              onChange={(v) => set("budgetBuffer", v)}
            />
          )}
          {d.buyForMe && <p className="text-small text-ink-2">{t(direct ? "direct.itemsRule" : "task.overBudgetRule")}</p>}
        </fieldset>
      )}{" "}
    </>
  );
}
