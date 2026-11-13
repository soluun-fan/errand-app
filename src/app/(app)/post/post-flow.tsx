"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { DashedAdd, OptionCard, PriceDeltaCard, ToggleRow } from "@/components/choice";
import { MoneyBreakdown, type MoneyRow } from "@/components/money-breakdown";
import { SubmitButton } from "@/components/sheet";
import { Note, btn, chipClass, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { AddressKind, SavedAddress } from "@/lib/addresses";
import { CATEGORIES, DEFAULT_CONFIG, heldItemBudget, isNight, quoteFee, type CategoryId, type ErrandDetails, type Lift } from "@/lib/engine";
import { DRAFT_KEY } from "@/lib/draft";
import { fmtMoney, parseUbLocal, toUbLocal } from "@/lib/format";
import { CATEGORY_ICON } from "@/lib/labels";
import { postTask, type PostState } from "./actions";

const cfg = DEFAULT_CONFIG;
const STEPS = ["what", "where", "review"] as const;
const TWO_POINT: CategoryId[] = ["shop", "deliver", "carry"];
const BUYS: CategoryId[] = ["shop", "deliver"];
const KM = [1, 3, 5, 10];

type When = "now" | "today" | "tomorrow" | "pick";
const KIND_ICON: Record<AddressKind, string> = { home: "🏠", work: "💼", other: "📍" };

export interface Draft {
  category: CategoryId;
  title: string;
  description: string;
  pickup: string;
  address: string;
  showDetails: boolean;
  entrance: string;
  floor: string;
  unit: string;
  lift: Lift | null;
  note: string;
  km: number;
  when: When;
  time: string;
  date: string;
  carryByHelper: boolean;
  heavy: boolean;
  roundTrip: boolean;
  buyForMe: boolean;
  itemBudget: string;
  budgetBuffer: boolean;
  people: 1 | 2;
  raise: number;
  /** Save the drop-off address as Home / Work / Other when posting ("" = don't). */
  saveAs: AddressKind | "";
}

/** The address fields a saved address fills in. */
function fromSaved(a: SavedAddress): Partial<Draft> {
  return {
    address: a.address,
    entrance: a.entrance ?? "",
    floor: a.floor === null ? "" : String(a.floor),
    unit: a.unit ?? "",
    lift: a.lift,
    note: a.note ?? "",
    showDetails: Boolean(a.entrance || a.floor !== null || a.unit || a.lift || a.note),
    saveAs: "",
  };
}

const digits = (s: string) => s.replace(/[^\d]/g, "");

/** The scheduled start as a UB wall-time string, or "" for "now". */
function startString(d: Draft, now: number): string {
  if (d.when === "now") return "";
  if (d.when === "pick") return d.date;
  const day = toUbLocal(now + (d.when === "tomorrow" ? 86_400_000 : 0)).slice(0, 10);
  return d.time ? `${day}T${d.time}` : "";
}

/**
 * Post a task in 3 steps (DESIGN §5.2–5.5): what → where & details → review & confirm.
 * Prices on screen come from the engine's quoteFee — the server re-runs the same function.
 */
export function PostFlow({
  initial,
  startStep = 0,
  defaultAddress,
  recent,
  saved,
}: {
  initial: Partial<Draft>;
  startStep?: number;
  defaultAddress: string;
  recent: string[];
  saved: SavedAddress[];
}) {
  const t = useT();
  const home = saved.find((a) => a.kind === "home");
  const blank: Draft = {
    category: "shop",
    title: "",
    description: "",
    pickup: "",
    address: defaultAddress,
    showDetails: false,
    entrance: "",
    floor: "",
    unit: "",
    lift: null,
    note: "",
    km: 1,
    when: "now",
    time: "",
    date: "",
    carryByHelper: true,
    heavy: false,
    roundTrip: false,
    buyForMe: false,
    itemBudget: "",
    budgetBuffer: false,
    people: 1,
    raise: 0,
    saveAs: "",
    ...(home && !initial.address ? fromSaved(home) : {}),
    ...initial,
  };
  const [d, setD] = useState<Draft>(blank);
  const [step, setStep] = useState(startStep);
  const [now, setNow] = useState(() => Date.now());
  const [state, action] = useActionState<PostState, FormData>(postTask, {});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  // Draft: restore unless arriving with a prefilled title; save on every change (DESIGN §7).
  useEffect(() => {
    if (initial.title) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setD((x) => ({ ...x, ...(JSON.parse(raw) as Partial<Draft>) }));
    } catch {
      /* storage unavailable */
    }
  }, [initial.title]);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  }, [d]);
  useEffect(() => {
    if (state.step !== undefined) setStep(state.step);
  }, [state]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const twoPoint = TWO_POINT.includes(d.category);
  const isCarry = d.category === "carry";
  const buys = BUYS.includes(d.category);
  const start = startString(d, now);
  const startsAt = start ? (parseUbLocal(start) ?? now) : now;
  const details: ErrandDetails = {
    km: twoPoint ? d.km : 0,
    entrance: d.entrance || null,
    floor: d.floor ? Number(d.floor) : null,
    unit: d.unit || null,
    lift: d.lift,
    note: d.note || null,
    people: d.people,
    carryByHelper: isCarry ? d.carryByHelper : true,
    heavy: isCarry && d.heavy,
    roundTrip: twoPoint && d.roundTrip,
    budgetBuffer: buys && d.buyForMe && d.budgetBuffer,
  };
  const quote = quoteFee(d.category, details, cfg, startsAt);
  const needTwo = quote.peopleRequired === 2;
  useEffect(() => {
    if (needTwo && d.people === 1) set("people", 2);
  }, [needTwo, d.people]);

  const fee = quote.total + d.raise;
  const itemBudget = buys && d.buyForMe ? Number(digits(d.itemBudget) || 0) : 0;
  // What is held for items: the typed budget plus the optional +10% (engine rule, same function).
  const heldItems = heldItemBudget(itemBudget, details.budgetBuffer, cfg);
  const total = fee + heldItems + cfg.serviceFee;
  const stairs = quote.lines.find((l) => l.key === "stairs");
  const backLeg = quoteFee(d.category, { ...details, roundTrip: true }, cfg, startsAt).lines.find((l) => l.key === "roundTrip");
  const savedMatch = saved.find((a) => a.address === d.address.trim());
  const savedName = (a: SavedAddress) => (a.kind === "other" ? (a.label ?? a.address) : t(`task.saved.${a.kind}`));

  let reason: string | null = null;
  if (step === 0 && (!d.title.trim() || !d.description.trim())) reason = t("task.reasonWhat");
  if (step === 1) {
    if (!d.address.trim()) reason = t("task.reasonWhere");
    else if (d.when !== "now" && (!start || (parseUbLocal(start) ?? 0) <= now)) reason = t("task.reasonTime");
    else if (buys && d.buyForMe && itemBudget <= 0) reason = t("task.reasonBudget");
  }

  const breakdown: MoneyRow[] = [
    { label: t("task.base", { category: t(`categoryShort.${d.category}`) }), amount: quote.base },
    ...quote.lines.map((l) => ({
      label: l.key === "stairs" ? t("task.stairs", { n: l.qty ?? 0 }) : l.key === "roundTrip" ? t("task.roundTripLine") : t("task.secondPerson"),
      amount: l.amount,
    })),
    ...(d.raise > 0 ? [{ label: t("task.raised"), amount: d.raise }] : []),
    ...(itemBudget > 0 ? [{ label: t("money.itemBudget"), amount: itemBudget }] : []),
    ...(heldItems > itemBudget ? [{ label: t("task.bufferLine"), amount: heldItems - itemBudget }] : []),
    { label: t("money.serviceFee"), amount: cfg.serviceFee, muted: true },
  ];

  return (
    <form
      action={action}
      className="flex flex-1 flex-col gap-5"
      onSubmit={() => {
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
      }}
    >
      {/* header: ✕ on step 1, ← after; centred title; n/3 */}
      <header className="grid min-h-14 grid-cols-[48px_1fr_48px] items-center">
        {step === 0 ? (
          <Link href="/" aria-label={t("task.close")} className="flex h-12 w-12 items-center justify-center rounded-full text-2xl hover:bg-fill">
            ✕
          </Link>
        ) : (
          <button type="button" aria-label={t("common.back")} onClick={() => setStep(step - 1)} className="flex h-12 w-12 items-center justify-center rounded-full text-2xl hover:bg-fill">
            ←
          </button>
        )}
        <h1 className="truncate text-center text-xl font-semibold">{t(`task.steps.${STEPS[step]}`)}</h1>
        <span className="text-right text-sm text-ink-2 tabular-nums">{step + 1}/3</span>
      </header>

      {/* every answer travels with the final submit */}
      <input type="hidden" name="category" value={d.category} />
      <input type="hidden" name="title" value={d.title} />
      <input type="hidden" name="description" value={d.description} />
      <input type="hidden" name="pickup" value={twoPoint ? d.pickup : ""} />
      <input type="hidden" name="address" value={d.address} />
      <input type="hidden" name="scheduledAt" value={start} />
      <input type="hidden" name="details" value={JSON.stringify(details)} />
      <input type="hidden" name="fee" value={fee} />
      <input type="hidden" name="buyForMe" value={buys && d.buyForMe ? "on" : ""} />
      <input type="hidden" name="itemBudget" value={itemBudget} />
      <input type="hidden" name="saveAs" value={savedMatch ? "" : d.saveAs} />

      {STEPS[step] === "what" && (
        <>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1" role="radiogroup">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={d.category === c.id} onClick={() => set("category", c.id)} className={chipClass(d.category === c.id)}>
                <span aria-hidden>{CATEGORY_ICON[c.id]}</span>
                {t(`categoryShort.${c.id}`)}
              </button>
            ))}
          </div>
          <label className={fieldLabel}>
            <span className="flex justify-between">
              {t("post.taskTitle")}
              <span className="tabular-nums">{t("post.counter", { n: d.title.length, max: cfg.titleMax })}</span>
            </span>
            <input className={field} value={d.title} maxLength={cfg.titleMax} onChange={(e) => set("title", e.target.value)} placeholder={t(`categoryExample.${d.category}`)} />
          </label>
          <label className={fieldLabel}>
            <span className="flex justify-between">
              {t("post.description")}
              <span className="tabular-nums">{t("post.counter", { n: d.description.length, max: cfg.descriptionMax })}</span>
            </span>
            <textarea className={`${field} min-h-32`} value={d.description} maxLength={cfg.descriptionMax} onChange={(e) => set("description", e.target.value)} placeholder={t("post.descriptionPh")} />
          </label>
          <Note tone="info">{t("post.rules")}</Note>
        </>
      )}

      {STEPS[step] === "where" && (
        <>
          {/* RouteCard (DESIGN §4.5) */}
          <div className="rounded-card border border-line">
            {twoPoint && (
              <label className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                <span aria-hidden className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-ink text-white">
                  ●
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs text-ink-2">{t("task.pickup")}</span>
                  <input className="min-h-8 bg-transparent text-[17px] font-medium outline-none placeholder:text-ink-3" value={d.pickup} onChange={(e) => set("pickup", e.target.value)} placeholder={t("task.pickupPh")} />
                </span>
              </label>
            )}
            <label className="flex items-center gap-3 px-4 py-2.5">
              <span aria-hidden className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-danger text-white">
                ↘
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs text-ink-2">{twoPoint ? t("task.drop") : t("task.where")}</span>
                <input className="min-h-8 bg-transparent text-[17px] font-medium outline-none placeholder:text-ink-3" value={d.address} onChange={(e) => set("address", e.target.value)} placeholder={twoPoint ? t("task.dropPh") : t("task.wherePh")} />
              </span>
            </label>
          </div>
          {(saved.length > 0 || recent.length > 0) && (
            <div className="-mx-5 -mt-2 flex gap-2 overflow-x-auto px-5">
              {saved.map((a) => (
                <button key={a.id} type="button" aria-pressed={savedMatch?.id === a.id} onClick={() => setD((x) => ({ ...x, ...fromSaved(a) }))} className={chipClass(savedMatch?.id === a.id)}>
                  <span aria-hidden>{KIND_ICON[a.kind]}</span> <span className="max-w-40 truncate">{savedName(a)}</span>
                </button>
              ))}
              {recent.map((a) => (
                <button key={a} type="button" onClick={() => set("address", a)} className={chipClass(false)}>
                  🕘 <span className="max-w-48 truncate">{a}</span>
                </button>
              ))}
            </div>
          )}

          {d.showDetails || isCarry || d.floor || d.entrance ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                {(["entrance", "floor", "unit"] as const).map((k) => (
                  <label key={k} className={fieldLabel}>
                    {t(`task.${k}`)}
                    <input className={field} inputMode="numeric" value={d[k]} maxLength={k === "floor" ? 2 : 10} onChange={(e) => set(k, k === "floor" ? digits(e.target.value) : e.target.value)} placeholder={k === "entrance" ? "1" : k === "floor" ? "5" : "54"} />
                  </label>
                ))}
              </div>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-[15px] font-medium text-ink-2">{t("task.lift")}</legend>
                <div className="grid grid-cols-3 gap-1 rounded-full bg-fill p-1" role="radiogroup">
                  {(["yes", "no", "unknown"] as const).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={d.lift === v} onClick={() => set("lift", v)} className={`min-h-11 rounded-full text-[15px] font-semibold ${d.lift === v ? "bg-bg text-ink shadow-float" : "text-ink-2"}`}>
                      {t(v === "yes" ? "task.liftYes" : v === "no" ? "task.liftNo" : "task.liftUnknown")}
                    </button>
                  ))}
                </div>
              </fieldset>
              {isCarry && d.lift === "unknown" && <p className="text-sm text-ink-2">{t("task.liftUnknownNote")}</p>}
              <label className={fieldLabel}>
                {t("task.note")}
                <textarea className={`${field} min-h-20`} value={d.note} maxLength={300} onChange={(e) => set("note", e.target.value)} placeholder={t("task.notePh")} />
              </label>
            </div>
          ) : (
            <DashedAdd label={t("task.addDetails")} onClick={() => set("showDetails", true)} />
          )}

          {d.address.trim() && !savedMatch && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("task.saveAs")}</legend>
              <div className="flex gap-2" role="radiogroup">
                {(["home", "work", "other"] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={d.saveAs === k} onClick={() => set("saveAs", d.saveAs === k ? "" : k)} className={chipClass(d.saveAs === k)}>
                    <span aria-hidden>{KIND_ICON[k]}</span> {t(`task.saved.${k}`)}
                  </button>
                ))}
              </div>
              {d.saveAs !== "" && d.saveAs !== "other" && saved.some((a) => a.kind === d.saveAs) && (
                <p className="text-sm text-ink-2">{t("task.saveReplaces", { name: t(`task.saved.${d.saveAs}`) })}</p>
              )}
            </fieldset>
          )}

          {twoPoint && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("task.distance")}</legend>
              <div className="flex gap-2" role="radiogroup">
                {KM.map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={d.km === k} onClick={() => set("km", k)} className={chipClass(d.km === k)}>
                    ~{k} км
                  </button>
                ))}
              </div>
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
            <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("task.when")}</legend>
            <div className="-mx-5 flex gap-2 overflow-x-auto px-5" role="radiogroup">
              {(["now", "today", "tomorrow", "pick"] as const).map((w) => (
                <button key={w} type="button" role="radio" aria-checked={d.when === w} onClick={() => set("when", w)} className={chipClass(d.when === w)}>
                  {w === "pick" ? "🗓 " : ""}
                  {t(w === "now" ? "task.whenNow" : w === "today" ? "task.whenToday" : w === "tomorrow" ? "task.whenTomorrow" : "task.whenPick")}
                </button>
              ))}
            </div>
            {(d.when === "today" || d.when === "tomorrow") && (
              <label className={fieldLabel}>
                {t("task.time")}
                <input type="time" className={field} value={d.time} onChange={(e) => set("time", e.target.value)} />
              </label>
            )}
            {d.when === "pick" && (
              <label className={fieldLabel}>
                {t("post.dateTime")}
                <input type="datetime-local" className={field} value={d.date} min={toUbLocal(now + 30 * 60_000)} onChange={(e) => set("date", e.target.value)} />
              </label>
            )}
            {isNight(startsAt) && <Note tone="warn">{t("post.nightNote", { amount: fmtMoney(cfg.nightMinFee) })}</Note>}
          </fieldset>

          {isCarry && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("task.carryHow")}</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                <PriceDeltaCard
                  selected={d.carryByHelper}
                  onSelect={() => set("carryByHelper", true)}
                  icon="🧍‍♂️"
                  title={t("task.carryHelper")}
                  sub={t("task.carryHelperSub")}
                  delta={stairs ? `+${fmtMoney(stairs.amount)}` : t("task.perFloor", { amount: fmtMoney(cfg.carryPerFloor) })}
                />
                <PriceDeltaCard selected={!d.carryByHelper} onSelect={() => set("carryByHelper", false)} icon="🚪" title={t("task.carrySelf")} sub={t("task.carrySelfSub")} delta={`+${fmtMoney(0)}`} free />
              </div>
              <ToggleRow icon="🧊" title={t("task.heavy")} sub={t("task.heavySub")} checked={d.heavy} onChange={(v) => set("heavy", v)} />
              {needTwo && <Note tone="warn">{t("task.needTwo")}</Note>}
            </fieldset>
          )}

          {buys && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("task.buyTitle")}</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                <PriceDeltaCard selected={!d.buyForMe} onSelect={() => set("buyForMe", false)} icon="🧾" title={t("task.buySelf")} sub={t("task.buySelfSub")} delta={`+${fmtMoney(0)}`} free />
                <PriceDeltaCard selected={d.buyForMe} onSelect={() => set("buyForMe", true)} icon="🛍️" title={t("task.buyForMe")} sub={t("task.buyForMeSub")} />
              </div>
              {d.buyForMe && (
                <label className={fieldLabel}>
                  {t("task.budget")}
                  <input className={`${field} text-[20px] font-bold tabular-nums`} inputMode="numeric" value={d.itemBudget} placeholder="20,000" onChange={(e) => set("itemBudget", digits(e.target.value))} />
                  <span className="text-sm font-normal">{t("post.itemsHelp")}</span>
                </label>
              )}
              {d.buyForMe && (
                <ToggleRow
                  icon="🧾"
                  title={t("task.buffer")}
                  sub={itemBudget > 0 ? t("task.bufferSub", { amount: fmtMoney(heldItemBudget(itemBudget, true, cfg) - itemBudget) }) : t("task.bufferSubEmpty")}
                  checked={d.budgetBuffer}
                  onChange={(v) => set("budgetBuffer", v)}
                />
              )}
              {d.buyForMe && <p className="text-sm text-ink-2">{t("task.overBudgetRule")}</p>}
            </fieldset>
          )}
        </>
      )}

      {STEPS[step] === "review" && (
        <>
          {startStep === 2 && <Note tone="info">{t("task.repeatNote")}</Note>}
          <div className="flex flex-col gap-2 rounded-card border border-line p-4">
            <p className="text-sm text-ink-2">
              <span aria-hidden>{CATEGORY_ICON[d.category]}</span> {t(`categoryShort.${d.category}`)} · {d.when === "now" ? t("task.whenNow") : start.replace("T", " ")}
            </p>
            <p className="text-[18px] font-semibold">{d.title}</p>
            {twoPoint && d.pickup && <p className="text-[15px] text-ink-2">● {d.pickup}</p>}
            <p className="text-[15px] text-ink-2">↘ {d.address}</p>
          </div>

          {isCarry && (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-[15px] font-medium text-ink-2">{t("task.team")}</legend>
              <OptionCard
                selected={d.people === 1}
                disabled={needTwo}
                onSelect={() => set("people", 1)}
                icon="🧍"
                title={t("task.oneHelper")}
                sub={needTwo ? t("task.tooHeavy") : undefined}
                price={fmtMoney(d.people === 1 ? quote.total : quote.total - cfg.secondPersonFee)}
              />
              <OptionCard
                selected={d.people === 2}
                onSelect={() => set("people", 2)}
                icon="🧍🧍"
                title={t("task.twoHelpers")}
                sub={t("task.twoHelpersSub")}
                price={fmtMoney(d.people === 2 ? quote.total : quote.total + cfg.secondPersonFee)}
              />
            </fieldset>
          )}

          <div className="flex flex-col gap-2 rounded-card bg-fill p-4">
            <span className="text-[15px] font-medium text-ink-2">{t("task.price")}</span>
            <div className="flex items-center gap-3">
              <button type="button" aria-label={t("task.lower")} disabled={d.raise === 0} onClick={() => set("raise", Math.max(0, d.raise - 1000))} className={`${btn.square} bg-bg disabled:text-ink-3`}>
                −
              </button>
              <span className="flex-1 text-center text-[28px] font-bold tabular-nums">{fmtMoney(fee)}</span>
              <button type="button" aria-label={t("task.raise")} onClick={() => set("raise", d.raise + 1000)} className={`${btn.square} bg-bg`}>
                +
              </button>
            </div>
            <p className="text-sm text-ink-2">{t("task.raiseHint")}</p>
          </div>

          <details className="group">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-[15px] font-medium">
              {t("task.breakdown")}
              <span aria-hidden className="transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <MoneyBreakdown rows={breakdown} total={{ label: t("money.totalHeld"), amount: total }} caption={itemBudget > 0 ? t("money.itemBudgetNote") : undefined} />
          </details>

          <p className="flex gap-2 rounded-input bg-held-bg p-3 text-[15px] text-held">
            <span aria-hidden>🔒</span>
            {t("task.heldLine")}
          </p>
        </>
      )}

      <div className="sticky bottom-0 -mx-5 mt-auto flex flex-col gap-1.5 border-t border-line bg-bg/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        {reason && <p className="text-center text-sm text-ink-2">{reason}</p>}
        <div className="flex gap-2">
          {step > 0 && (
            <button type="button" aria-label={t("common.back")} onClick={() => setStep(step - 1)} className={btn.square}>
              ←
            </button>
          )}
          {STEPS[step] === "review" ? (
            <SubmitButton className={`${btn.primary} flex-1`}>{t("task.confirm", { amount: fmtMoney(total) })}</SubmitButton>
          ) : (
            <button type="button" disabled={!!reason} onClick={() => setStep(step + 1)} className={`${btn.primary} flex-1`}>
              {step === 1 ? t("task.continueAmount", { amount: fmtMoney(total) }) : t("common.next")}
            </button>
          )}
        </div>
        {STEPS[step] === "review" && (
          <p className="text-center text-xs text-ink-2">
            {t("task.terms")}{" "}
            <Link href="/help" className="underline underline-offset-2">
              {t("task.termsLink")}
            </Link>
          </p>
        )}
      </div>
    </form>
  );
}
