"use client";

import { ArrowLeft, Info, X } from "lucide-react";
import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import { Fragment, useActionState, useEffect, useState } from "react";
import { DashedAdd, OptionCard, PriceDeltaCard, ToggleRow } from "@/components/choice";
import { MoneyBreakdown, type MoneyRow } from "@/components/money-breakdown";
import { PinMap, type Pin } from "@/components/pin-map";
import { SubmitButton } from "@/components/sheet";
import { TaskPhotoPicker, type PickedPhoto } from "@/components/task-photo-picker";
import { Avatar, Note, btn, chipClass, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { AddressKind, SavedAddress } from "@/lib/addresses";
import { CATEGORIES, categoryConfig, categoryTrust, DEFAULT_DETAILS, TWO_POINT_CATEGORIES, heldItemBudget, roadKm, isNight, kindFromLabel, LANGUAGES, quoteFee, serviceFeeFor, suggestedMinutes, taskMinFee, type TaskConditions, type CategoryId, type EngineConfig, type ErrandDetails, type Lift, type QuoteLine } from "@/lib/engine";
import { DRAFT_KEY } from "@/lib/draft";
import { fmtMoney, parseUbLocal, toUbLocal } from "@/lib/format";
import { postTask, type PostState } from "./actions";

/** One decision per screen (redesign): kind of task → what exactly → where & when → review. */
const STEPS = ["type", "what", "where", "review"] as const;
const KM = [1, 3, 5, 10];
/** "About how long?" choices, in minutes. */
const DURATIONS = [30, 60, 90, 120, 180, 240, 360, 480];

/** "flexible": not urgent — the post stays open for the Ops search window (24 h), offers don't lapse. */
type When = "now" | "today" | "tomorrow" | "pick" | "flexible";
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
  /** The customer's own price as typed ("" = not set yet → the minimum). We only set the floor. */
  price: string;
  /** About how long (minutes); null = the category's usual. */
  minutes: number | null;
  /** The helper must bring tools. */
  tools: boolean;
  /** What the customer requires of the helper (docs/decisions.md 2026-11-18 "Task conditions"). */
  require: TaskConditions;
  /** Save the drop-off address as Home / Work / Other when posting ("" = don't). */
  saveAs: AddressKind | "";
  /** Map pin for the drop-off / task place (drives nearby dispatch). */
  pin: Pin | null;
  /** Two-point tasks: map pin for the pickup. With both pins the distance is measured, not guessed. */
  pickupPin: Pin | null;
  /** "Choose for me": pick the best applicant if I haven't chosen in a few minutes. */
  autoPick: boolean;
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
    pin: a.lat !== null && a.lng !== null ? { lat: a.lat, lng: a.lng } : null,
  };
}

const digits = (s: string) => s.replace(/[^\d]/g, "");

/** The scheduled start as a UB wall-time string, or "" for "now". */
function startString(d: Draft, now: number): string {
  if (d.when === "now" || d.when === "flexible") return "";
  if (d.when === "pick") return d.date;
  const day = toUbLocal(now + (d.when === "tomorrow" ? 86_400_000 : 0)).slice(0, 10);
  return d.time ? `${day}T${d.time}` : "";
}

/**
 * Post a task in 3 steps (DESIGN §5.2–5.5): what → where & details → review & confirm.
 * Prices on screen come from the engine's quoteFee — the server re-runs the same function.
 */
/** A direct request: the helper it goes to first (from their profile). */
export interface InviteTarget {
  id: string;
  name: string;
  categories: CategoryId[];
}

export function PostFlow({
  initial,
  startStep = 0,
  defaultAddress,
  recent,
  saved,
  cfg,
  invite = null,
  live,
}: {
  live: CategoryId[];
  invite?: InviteTarget | null;
  /** Today's prices (engine defaults + the live Ops settings). */
  cfg: EngineConfig;
  initial: Partial<Draft>;
  startStep?: number;
  defaultAddress: string;
  recent: string[];
  saved: SavedAddress[];
}) {
  const t = useT();
  const home = saved.find((a) => a.kind === "home");
  const blank: Draft = {
    category: (invite?.categories ?? live)[0] ?? "shop",
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
    price: "",
    minutes: null,
    tools: false,
    require: {},
    saveAs: "",
    pin: null,
    pickupPin: null,
    autoPick: true,
    ...(home && !initial.address ? fromSaved(home) : {}),
    ...initial,
  };
  const [d, setD] = useState<Draft>(blank);
  /** Direct request: if the helper says no or doesn't answer in time, let everyone apply. */
  const [openAfter, setOpenAfter] = useState(true);
  /** Photos uploaded while filling in (not part of the saved draft: uploads expire after a day). */
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const kinds = CATEGORIES.filter((c) => live.includes(c.id) && (!invite || invite.categories.includes(c.id)));
  const [step, setStep] = useState(startStep);
  /** Which point the map is placing (two-point tasks). */
  const [pinTarget, setPinTarget] = useState<"pickup" | "drop">("drop");
  const [now, setNow] = useState(() => Date.now());
  const [state, action] = useActionState<PostState, FormData>(postTask, {});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  /** A kind's "from" price on its card: "3,000₮-өөс" or, for hourly kinds, "6,000₮/цаг-аас". */
  const kindFrom = (c: CategoryId) => {
    const f = kindFromLabel(c, cfg);
    return f.hourly ? t("home.fromHourly", { amount: fmtMoney(f.amount) }) : t("home.from", { amount: fmtMoney(f.amount) });
  };

  // Draft: restore unless arriving with a prefilled title; save on every change (DESIGN §7).
  useEffect(() => {
    if (initial.title) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<Draft>;
        // a direct request keeps to the kinds of task that helper does
        if (draft.category && (!live.includes(draft.category) || (invite && !invite.categories.includes(draft.category)))) delete draft.category;
        setD((x) => ({ ...x, ...draft }));
      }
    } catch {
      /* storage unavailable */
    }
  }, [initial.title, invite, live]);
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

  const twoPoint = TWO_POINT_CATEGORIES.includes(d.category);
  const isCarry = d.category === "carry";
  const buys = categoryConfig(d.category).items;
  const care = categoryTrust(d.category) === "care";
  const start = startString(d, now);
  const startsAt = start ? (parseUbLocal(start) ?? now) : now;
  // both pins → distance from the map (same function as the server); otherwise the rough chip
  const measuredKm = twoPoint && d.pin && d.pickupPin ? roadKm(d.pickupPin, d.pin) : null;
  const tripKm = twoPoint ? (measuredKm ?? d.km) : 0;
  const usualMinutes = CATEGORIES.find((c) => c.id === d.category)?.minutes ?? 30;
  // "About how long?" follows the trip: the usual time plus travel there (and back), unless picked
  const autoMinutes = Math.min(care ? cfg.careMaxMinutes : 480, suggestedMinutes(usualMinutes, tripKm, twoPoint && d.roundTrip, cfg));
  const travelMinutes = Math.round(tripKm * cfg.travelMinPerKm * (twoPoint && d.roundTrip ? 2 : 1));
  const details: ErrandDetails = {
    km: tripKm,
    entrance: d.entrance || null,
    floor: d.floor ? Number(d.floor) : null,
    unit: d.unit || null,
    lift: d.lift,
    note: d.note || null,
    people: d.people,
    carryByHelper: isCarry ? d.carryByHelper : true,
    heavy: d.heavy,
    roundTrip: twoPoint && d.roundTrip,
    budgetBuffer: buys && d.buyForMe && d.budgetBuffer,
    // a direct request: the customer answers that helper themselves; not urgent: they compare at leisure
    autoPick: invite || care || d.when === "flexible" ? false : d.autoPick,
    minutes: d.minutes ?? autoMinutes,
    tools: d.tools,
    quotedFee: 0,
    counterMax: 0,
    require: d.require ?? {},
  };
  const quote = quoteFee(d.category, details, cfg, startsAt);
  const needTwo = quote.peopleRequired === 2;
  useEffect(() => {
    if (needTwo && d.people === 1) set("people", 2);
  }, [needTwo, d.people]);

  // Freedom, but limited (docs/decisions.md "Pricing"): recommended −20%…+30%, same function as the server.
  // The customer names the price; we only set the floor (docs/decisions.md 2026-11-16 "Bargaining").
  // this task's floor: its kind's minimum (or hourly floor × hours) + the trip + night (engine rule)
  const minFee = taskMinFee(d.category, details, startsAt, cfg);
  const hourly = cfg.kindMinHourly[d.category];
  const typed = Number(digits(d.price ?? ""));
  const fee = typed > 0 ? typed : minFee;
  const belowMin = typed > 0 && typed < minFee;
  const serviceFee = serviceFeeFor(fee, cfg);
  const itemBudget = buys && d.buyForMe ? Number(digits(d.itemBudget) || 0) : 0;
  // What is held for items: the typed budget plus the optional +10% (engine rule, same function).
  const heldItems = heldItemBudget(itemBudget, details.budgetBuffer, cfg);
  const total = fee + heldItems + serviceFee;
  const stairs = quote.lines.find((l) => l.key === "stairs");
  const backLeg = quoteFee(d.category, { ...details, roundTrip: true }, cfg, startsAt).lines.find((l) => l.key === "roundTrip");
  const savedMatch = saved.find((a) => a.address === d.address.trim());
  const savedName = (a: SavedAddress) => (a.kind === "other" ? (a.label ?? a.address) : t(`task.saved.${a.kind}`));

  let reason: string | null = null;
  if (STEPS[step] === "what" && (!d.title.trim() || !d.description.trim())) reason = t("task.reasonWhat");
  if (STEPS[step] === "where") {
    if (!d.address.trim()) reason = t("task.reasonWhere");
    else if (d.when !== "now" && d.when !== "flexible" && (!start || (parseUbLocal(start) ?? 0) <= now)) reason = t("task.reasonTime");
    else if (buys && d.buyForMe && itemBudget <= 0) reason = t("task.reasonBudget");
  }
  if (STEPS[step] === "review" && belowMin) reason = t("post.reason.fee", { amount: fmtMoney(minFee) });

  const lineLabel = (l: QuoteLine) =>
    l.key === "time"
      ? t("price.line.time", { min: l.qty ?? 0 })
      : l.key === "distance"
        ? t("price.line.distance", { km: l.qty ?? 0 })
        : l.key === "stairs"
          ? t("price.line.stairs", { n: l.qty ?? 0 })
          : l.key === "base"
            ? t("price.line.base", { min: cfg.includedMinutes, km: cfg.includedKm })
            : t(`price.line.${l.key}`);
  // fee-only (docs/decisions.md 2026-11-18): the app takes only our fee; the helper is paid directly
  const direct = cfg.payMode === "direct";
  const breakdown: MoneyRow[] = direct
    ? [
        { label: t("direct.money.toHelperLater"), amount: fee },
        ...(itemBudget > 0 ? [{ label: t("direct.money.itemsLater"), amount: itemBudget, muted: true }] : []),
        { label: t("direct.money.feeNow"), amount: serviceFee },
      ]
    : [
        { label: t("price.yourPrice"), amount: fee },
        ...(itemBudget > 0 ? [{ label: t("money.itemBudget"), amount: itemBudget }] : []),
        ...(heldItems > itemBudget ? [{ label: t("task.bufferLine"), amount: heldItems - itemBudget }] : []),
        { label: t("money.serviceFee"), amount: serviceFee, muted: true },
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
      {/* header: ✕ on the first step, ← after; n/4; a thin progress bar; the step's one question */}
      <header className="flex flex-col gap-3 pt-1">
        <div className="flex items-center justify-between">
          {step === 0 ? (
            <Link href="/" aria-label={t("task.close")} className="press flex h-11 w-11 items-center justify-center rounded-full bg-bg shadow-card">
              <X aria-hidden size={20} />
            </Link>
          ) : (
            <button type="button" aria-label={t("common.back")} onClick={() => setStep(step - 1)} className="press flex h-11 w-11 items-center justify-center rounded-full bg-bg shadow-card">
              <ArrowLeft aria-hidden size={20} />
            </button>
          )}
          <span className="text-[13px] font-semibold text-ink-2 tabular-nums">
            {step + 1} / {STEPS.length}
          </span>
        </div>
        <span aria-hidden className="h-1 overflow-hidden rounded-full bg-line">
          <span className="block h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </span>
        <h1 className="text-[22px] font-bold leading-tight tracking-tight">{t(`task.steps.${STEPS[step]}`)}</h1>
        {invite && (
          <p className="flex items-center gap-2.5 rounded-card bg-brand-bg p-3 text-[14px] text-brand-ink">
            <Avatar name={invite.name} size={32} />
            <span className="min-w-0 flex-1">{t("invite.banner", { name: invite.name })}</span>
          </p>
        )}
      </header>

      {/* every answer travels with the final submit */}
      <input type="hidden" name="category" value={d.category} />
      <input type="hidden" name="title" value={d.title} />
      <input type="hidden" name="description" value={d.description} />
      <input type="hidden" name="pickup" value={twoPoint ? d.pickup : ""} />
      <input type="hidden" name="address" value={d.address} />
      <input type="hidden" name="scheduledAt" value={start} />
      <input type="hidden" name="mode" value={d.when === "flexible" ? "schedule" : "now"} />
      <input type="hidden" name="details" value={JSON.stringify(details)} />
      <input type="hidden" name="fee" value={fee} />
      <input type="hidden" name="buyForMe" value={buys && d.buyForMe ? "on" : ""} />
      <input type="hidden" name="itemBudget" value={itemBudget} />
      <input type="hidden" name="saveAs" value={savedMatch ? "" : d.saveAs} />
      <input type="hidden" name="location" value={d.pin ? JSON.stringify(d.pin) : ""} />
      <input type="hidden" name="pickupLocation" value={twoPoint && d.pickupPin ? JSON.stringify(d.pickupPin) : ""} />
      <input type="hidden" name="invite" value={invite?.id ?? ""} />
      <input type="hidden" name="inviteOpenAfter" value={invite && openAfter ? "on" : ""} />
      <input type="hidden" name="photos" value={categoryTrust(d.category) === "care" ? "[]" : JSON.stringify(photos.map((p) => p.id))} />

      {STEPS[step] === "type" && (
        <div className="flex flex-col gap-2.5" role="radiogroup" aria-label={t("task.steps.type")}>
          {kinds.map((c, i) => {
            const on = d.category === c.id;
            // a heading where everyday work ends and specialized (certified / organisation) work starts
            const groupStart = c.trust !== "open" && (i === 0 || kinds[i - 1].trust === "open");
            return (
              <Fragment key={c.id}>
              {groupStart && <h2 className="pt-2 text-[13px] font-semibold text-ink-2">{t("home.kinds.specialized")}</h2>}
              <button
                type="button"
                role="radio"
                aria-checked={on}
                // one tap answers this screen's question and moves on
                onClick={() => {
                  setD((x) => ({ ...x, category: c.id }));
                  setStep(1);
                }}
                className={`press flex items-center gap-3 rounded-card border-2 bg-bg p-3.5 text-left shadow-card ${on ? "border-brand" : "border-transparent"}`}
              >
                <CategoryIcon id={c.id} tile size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">{t(`category.${c.id}`)}</span>
                  <span className="block truncate text-[13px] text-ink-2">{t(`categoryExample.${c.id}`)}</span>
                </span>
                <span className="flex-none text-[13px] font-semibold text-brand-ink tabular-nums">{kindFrom(c.id)}</span>
              </button>
              </Fragment>
            );
          })}
          <p className="flex items-start gap-2 rounded-card bg-bg p-3.5 text-[13px] text-ink-2 shadow-card">
            <Info aria-hidden size={16} className="mt-0.5 flex-none" />
            {t("task.typeHint", { amount: fmtMoney(minFee) })}
          </p>
        </div>
      )}

      {STEPS[step] === "what" && (
        <>
          <button type="button" onClick={() => setStep(0)} className="press flex items-center gap-2 self-start rounded-full bg-brand-bg px-3 py-1.5 text-[13px] font-semibold text-brand-ink">
            <CategoryIcon id={d.category} size={16} />
            {t(`categoryShort.${d.category}`)} · {t("task.change")}
          </button>
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
          {/* no pictures on care tasks (children, elders) */}
          {categoryTrust(d.category) !== "care" && <TaskPhotoPicker value={photos} onChange={setPhotos} />}
          {categoryTrust(d.category) === "care" && <Note tone="warn">{t(d.category === "eldercare" ? "care.scopeElder" : "care.scopeChild")}</Note>}
          <Note tone="info">{t("post.rules")}</Note>
        </>
      )}

      {STEPS[step] === "where" && (
        <>
          <section className="flex flex-col gap-2">
            <div>
              <h2 className="text-[15px] font-semibold">{twoPoint ? t("map.pinTitleTwo") : t("map.pinTitle")}</h2>
              <p className="text-sm text-ink-2">{twoPoint ? t("map.pinSubTwo") : t("map.pinSub")}</p>
            </div>
            {twoPoint && (
              <div className="grid grid-cols-2 gap-1 rounded-full bg-fill p-1" role="radiogroup" aria-label={t("map.pinTitleTwo")}>
                {(["pickup", "drop"] as const).map((k) => {
                  const done = k === "pickup" ? d.pickupPin : d.pin;
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={pinTarget === k}
                      onClick={() => setPinTarget(k)}
                      className={`min-h-11 rounded-full text-[15px] font-semibold ${pinTarget === k ? "bg-bg text-ink shadow-float" : "text-ink-2"}`}
                    >
                      {k === "pickup" ? "● " : "↘ "}
                      {t(k === "pickup" ? "map.setPickup" : "map.setDrop")}
                      {done ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
            )}
            {twoPoint && pinTarget === "pickup" ? (
              <PinMap
                key="pickup"
                kind="pickup"
                value={d.pickupPin}
                start={d.pin}
                onChange={(p) => set("pickupPin", p)}
                other={d.pin ? { ...d.pin, kind: "drop" } : null}
              />
            ) : (
              <PinMap
                key="drop"
                value={d.pin}
                start={twoPoint ? d.pickupPin : null}
                onChange={(p) => set("pin", p)}
                other={twoPoint && d.pickupPin ? { ...d.pickupPin, kind: "pickup" } : null}
              />
            )}
            {twoPoint && d.pickupPin && (
              <button type="button" onClick={() => set("pickupPin", null)} className="self-start text-sm font-medium text-ink-2 underline underline-offset-4">
                {t("map.clearPickup")}
              </button>
            )}
          </section>
          {/* RouteCard (DESIGN §4.5) */}
          <div className="rounded-card border border-line bg-bg">
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
              {measuredKm !== null ? (
                <p className="rounded-input bg-fill px-4 py-3 text-[16px] font-medium">📏 {t("map.measured", { km: measuredKm.toFixed(1) })}</p>
              ) : (
                <>
                  <div className="flex gap-2" role="radiogroup">
                    {KM.map((k) => (
                      <button key={k} type="button" role="radio" aria-checked={d.km === k} onClick={() => set("km", k)} className={chipClass(d.km === k)}>
                        ~{k} км
                      </button>
                    ))}
                  </div>
                  <p className="text-sm text-ink-2">{t("map.noPickupPin")}</p>
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
            <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("task.when")}</legend>
            <div className="-mx-5 flex gap-2 overflow-x-auto px-5" role="radiogroup">
              {(["now", "flexible", "today", "tomorrow", "pick"] as const).map((w) => (
                <button key={w} type="button" role="radio" aria-checked={d.when === w} onClick={() => set("when", w)} className={chipClass(d.when === w)}>
                  {w === "pick" ? "🗓 " : ""}
                  {w === "flexible"
                    ? t("task.whenFlexible", { hours: Math.round(cfg.scheduleMatchWindowMinutes / 60) })
                    : t(w === "now" ? "task.whenNow" : w === "today" ? "task.whenToday" : w === "tomorrow" ? "task.whenTomorrow" : "task.whenPick")}
                </button>
              ))}
            </div>
            {d.when === "flexible" && <Note tone="info">{t("task.whenFlexibleNote", { hours: Math.round(cfg.scheduleMatchWindowMinutes / 60) })}</Note>}
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
            {isNight(startsAt) && <Note tone="warn">{t("price.nightNote", { amount: fmtMoney(cfg.nightFee) })}</Note>}
          </fieldset>

          {/* Effort: what the price is built from — works for any job, even an unusual one */}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("price.howLong")}</legend>
            <div className="-mx-5 flex gap-2 overflow-x-auto px-5" role="radiogroup">
              {DURATIONS.filter((m) => !care || m <= cfg.careMaxMinutes).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={details.minutes === m} onClick={() => set("minutes", m)} className={chipClass(details.minutes === m)}>
                  {m < 60 ? t("price.min", { n: m }) : t("price.hours", { n: m / 60 })}
                </button>
              ))}
            </div>
            <p className="text-sm text-ink-2">{t("price.howLongHelp", { amount: fmtMoney(cfg.perHalfHour), min: cfg.includedMinutes })}</p>
            {travelMinutes > 0 && (
              <p className="text-sm text-ink-2">
                {t(d.roundTrip ? "price.travelBoth" : "price.travelOne", { min: travelMinutes })}
                {d.minutes !== null && d.minutes < autoMinutes ? ` ${t("price.travelShort", { min: autoMinutes })}` : ""}
              </p>
            )}
            {care && <Note tone="info">{t("care.pilotHours", { from: cfg.careDayStartHour, to: cfg.careDayEndHour, hours: cfg.careMaxMinutes / 60 })}</Note>}
            <ToggleRow icon="🧊" title={t("task.heavy")} sub={t("price.heavySub", { amount: fmtMoney(cfg.heavyFee) })} checked={d.heavy} onChange={(v) => set("heavy", v)} />
            <ToggleRow icon="🧰" title={t("price.tools")} sub={t("price.toolsSub", { amount: fmtMoney(cfg.toolsFee) })} checked={d.tools} onChange={(v) => set("tools", v)} />
          </fieldset>

          {/* conditions for the helper (docs/decisions.md 2026-11-18): only helpers who meet them can apply */}
          <details className="group flex flex-col gap-3" open={Object.values(d.require ?? {}).some(Boolean)}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-[15px] font-medium text-ink-2">
              {t("conditions.postTitle")}
              <span aria-hidden className="transition-transform group-open:rotate-180">▾</span>
            </summary>
            <p className="pb-2 text-sm text-ink-2">{t("conditions.postSub")}</p>
            <div className="flex flex-col gap-3">
              {(
                [
                  ["driver", "🚗"],
                  ["car", "🚙"],
                  ["call", "📞"],
                  ["onTime", "⏰"],
                  ["checked", "🛡️"],
                  ["handoverCode", "🔢"],
                ] as const
              ).map(([k, icon]) => (
                <ToggleRow
                  key={k}
                  icon={icon}
                  title={t(`conditions.k.${k}`)}
                  sub={t(`conditions.sub.${k}`)}
                  checked={Boolean(d.require?.[k])}
                  onChange={(v) => set("require", { ...(d.require ?? {}), [k]: v || undefined })}
                />
              ))}
              <label className={fieldLabel}>
                🌐 {t("conditions.k.language")}
                <select
                  className={field}
                  value={d.require?.language ?? ""}
                  onChange={(e) => set("require", { ...(d.require ?? {}), language: (e.target.value || null) as TaskConditions["language"] })}
                >
                  <option value="">{t("conditions.anyLanguage")}</option>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {t(`conditions.lang.${l}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>

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
              {/* the +10% buffer is only meaningful when the money is held */}
              {d.buyForMe && !direct && (
                <ToggleRow
                  icon="🧾"
                  title={t("task.buffer")}
                  sub={itemBudget > 0 ? t("task.bufferSub", { amount: fmtMoney(heldItemBudget(itemBudget, true, cfg) - itemBudget) }) : t("task.bufferSubEmpty")}
                  checked={d.budgetBuffer}
                  onChange={(v) => set("budgetBuffer", v)}
                />
              )}
              {d.buyForMe && <p className="text-sm text-ink-2">{t(direct ? "direct.itemsRule" : "task.overBudgetRule")}</p>}
            </fieldset>
          )}
        </>
      )}

      {STEPS[step] === "review" && (
        <>
          {startStep === STEPS.indexOf("review") && <Note tone="info">{t("task.repeatNote")}</Note>}
          <div className="flex flex-col gap-2 rounded-card border border-line bg-bg p-4">
            <p className="text-sm text-ink-2">
              <CategoryIcon id={d.category} size={16} /> {t(`categoryShort.${d.category}`)} · {d.when === "now" ? t("task.whenNow") : d.when === "flexible" ? t("task.whenFlexible", { hours: Math.round(cfg.scheduleMatchWindowMinutes / 60) }) : start.replace("T", " ")}
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
                price="" 
              />
              <OptionCard
                selected={d.people === 2}
                onSelect={() => set("people", 2)}
                icon="🧍🧍"
                title={t("task.twoHelpers")}
                sub={t("task.twoHelpersSub")}
                price="" 
              />
            </fieldset>
          )}

          {/* the customer's own price — only the minimum is ours; helpers may answer with theirs */}
          <div className="flex flex-col gap-2 rounded-card bg-bg p-4 shadow-card">
            <label htmlFor="price" className="text-[13px] font-semibold text-ink-2">
              {t("price.yourPrice")}
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={t("task.lower")}
                disabled={fee - cfg.feeStep < minFee}
                onClick={() => set("price", String(Math.max(minFee, fee - cfg.feeStep)))}
                className={`${btn.square} disabled:text-ink-3`}
              >
                −
              </button>
              <span className="relative flex-1">
                <input
                  id="price"
                  inputMode="numeric"
                  value={d.price ? Number(digits(d.price)).toLocaleString("en-US") : ""}
                  placeholder={fmtMoney(minFee).replace("₮", "")}
                  onChange={(e) => set("price", digits(e.target.value).slice(0, 8))}
                  className={`${field} pr-9 text-center text-[24px] font-bold tabular-nums text-brand-ink`}
                />
                <span aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[20px] font-bold text-brand-ink">
                  ₮
                </span>
              </span>
              <button type="button" aria-label={t("task.raise")} onClick={() => set("price", String(fee + cfg.feeStep))} className={btn.square}>
                +
              </button>
            </div>
            {belowMin ? (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {t("post.reason.fee", { amount: fmtMoney(minFee) })}
              </p>
            ) : (
              <p className="text-[13px] text-ink-2">{t("price.minHint", { min: fmtMoney(minFee) })}</p>
            )}
            {/* hourly kinds (day jobs, care): what the price means per hour */}
            {hourly && details.minutes > 0 && (
              <p className="text-[13px] font-medium text-ink-2">
                {t("price.perHour", { amount: fmtMoney(Math.floor(fee / (details.minutes / 60))), floor: fmtMoney(hourly) })}
              </p>
            )}
            <p className="text-[13px] text-ink-2">{t("price.bargainHint")}</p>
          </div>

          <details className="group">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-[15px] font-medium">
              {t("task.breakdown")}
              <span aria-hidden className="transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <MoneyBreakdown
              rows={breakdown}
              total={direct ? { label: t("direct.money.payWhenChosen"), amount: serviceFee } : { label: t("money.totalHeld"), amount: total }}
              caption={itemBudget > 0 && !direct ? t("money.itemBudgetNote") : undefined}
            />
          </details>

          {invite ? (
            <ToggleRow
              icon="👥"
              title={t("invite.openAfter", { name: invite.name })}
              sub={t("invite.openAfterSub", { minutes: d.when === "now" ? cfg.inviteMinutes : cfg.inviteMinutesScheduled })}
              checked={openAfter}
              onChange={setOpenAfter}
            />
          ) : care ? <p className="rounded-input bg-fill p-3 text-sm">{t("specialized.care")}</p> : d.when === "flexible" ? null : (
            <ToggleRow icon="✨" title={t("task.autoPick")} sub={t("task.autoPickSub", { minutes: cfg.autoPickMinutes })} checked={d.autoPick} onChange={(v) => set("autoPick", v)} />
          )}

          {care && invite && <p className="rounded-input bg-fill p-3 text-sm">{t("specialized.care")}</p>}
          {categoryConfig(d.category).checkHours && <p className="text-sm text-ink-2">{t("specialized.check", { hours: categoryConfig(d.category).checkHours! })}</p>}
          <p className="flex gap-2 rounded-input bg-held-bg p-3 text-[15px] text-held">
            <span aria-hidden>🔒</span>
            {t("task.heldLine")}
          </p>
        </>
      )}

      <div className="sticky bottom-0 -mx-5 mt-auto flex flex-col gap-1.5 bg-canvas/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        {reason && <p className="text-center text-sm text-ink-2">{reason}</p>}
        <div className="flex gap-2">
          {step > 0 && (
            <button type="button" aria-label={t("common.back")} onClick={() => setStep(step - 1)} className={`${btn.square} bg-bg shadow-card`}>
              <ArrowLeft aria-hidden size={20} />
            </button>
          )}
          {STEPS[step] === "review" ? (
            <SubmitButton className={`${btn.primary} flex-1`} disabled={!!reason}>
              {t("task.confirm", { amount: fmtMoney(direct ? fee : total) })}
            </SubmitButton>
          ) : (
            <button type="button" disabled={!!reason} onClick={() => setStep(step + 1)} className={`${btn.primary} flex-1`}>
              {t("common.next")}
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
