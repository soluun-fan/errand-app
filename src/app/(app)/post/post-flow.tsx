"use client";

import { ArrowLeft, Briefcase, CalendarDays, ChevronDown, DoorOpen, Hand, House, Info, Lock, MapPin, PencilLine, Receipt, Ruler, ShoppingBag, Sparkles, User, Users, Weight, Wrench, X } from "lucide-react";
import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import { AddressInput, type AddressChoice } from "@/components/address-input";
import { JOB_VARIETIES, type JobVariety } from "@/lib/engine/job-varieties";
import { ConditionPicker } from "@/components/condition-picker";
import { ConditionChips } from "@/components/conditions";
import { TaskBrief } from "@/components/task-brief";
import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import { DashedAdd, OptionCard, PriceDeltaCard, ToggleRow } from "@/components/choice";
import { MoneyBreakdown, type MoneyRow } from "@/components/money-breakdown";
import type { Pin } from "@/components/pin-map";
import { SubmitButton } from "@/components/sheet";
import { TaskPhotoPicker, type PickedPhoto } from "@/components/task-photo-picker";
import { Avatar, Note, btn, chipClass, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { AddressKind, SavedAddress } from "@/lib/addresses";
import { CATEGORIES, categoryConfig, customerChoosesHelper, categoryTrust, DEFAULT_DETAILS, TWO_POINT_CATEGORIES, heldItemBudget, roadKm, extraTaskFeeFor, isNight, kindFromLabel, quoteFee, serviceFeeFor, suggestedMinutes, suggestedPrice, taskMinFee, type TaskConditions, type CategoryId, type EngineConfig, type ErrandDetails, type Lift, type QuoteLine } from "@/lib/engine";
import { draftKeyFor } from "@/lib/draft";
import { titleFromBrief } from "@/lib/task-brief";
import { fmtMoney, parseUbLocal, toUbLocal } from "@/lib/format";
import { useRouter } from "next/navigation";
import { postTask, type PostState } from "./actions";
import { Ico } from "@/components/icon";
import type { LucideIcon } from "lucide-react";

/** One decision per screen (redesign): kind of task → what exactly → where & when → review. */
const STEPS = ["type", "what", "where", "review"] as const;
const KM = [1, 3, 5, 10];
/** "About how long?" choices, in minutes. */
const DURATIONS = [30, 60, 90, 120, 180, 240, 360, 480];

/** "flexible": not urgent — the post stays open for the Ops search window (24 h), offers don't lapse. */
type When = "now" | "today" | "tomorrow" | "pick" | "flexible";
const KIND_ICON: Record<AddressKind, LucideIcon> = { home: House, work: Briefcase, other: MapPin };

export interface Draft {
  variety?: JobVariety;
  category: CategoryId;
  title: string;
  /** An explicitly chosen title is preserved; otherwise it follows the request message. */
  customTitle?: boolean;
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
    showDetails: false,
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
  userId,
  initial,
  startStep = 0,
  defaultAddress,
  recent,
  saved,
  cfg,
  invite = null,
  live,
  openTasks = 0,
  firstTask = false,
}: {
  userId: string;
  live: CategoryId[];
  invite?: InviteTarget | null;
  /** Today's prices (engine defaults + the live Ops settings). */
  cfg: EngineConfig;
  /** The customer's active tasks right now; beyond the free ones the service fee is a little higher. */
  openTasks?: number;
  /** No service fee: the customer's first task (server-checked; the engine decides again on posting). */
  firstTask?: boolean;
  initial: Partial<Draft>;
  startStep?: number;
  defaultAddress: string;
  recent: string[];
  saved: SavedAddress[];
}) {
  const t = useT();
  const router = useRouter();
  const draftKey = draftKeyFor(userId);
  const home = saved.find((a) => a.kind === "home");
  const blank: Draft = {
    category: (invite?.categories ?? live)[0] ?? "shop",
    title: "",
    customTitle: Boolean(initial.title),
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
    // purchases default to "buy it for me, paid back by receipt" (owner, 2026-11-24)
    buyForMe: true,
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
    description: initial.description || initial.title || "",
  };
  const [d, setD] = useState<Draft>(blank);
  const [pendingCondition, setPendingCondition] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  /** Direct request: if the helper says no or doesn't answer in time, let everyone apply. */
  const [openAfter, setOpenAfter] = useState(true);
  /** Photos uploaded while filling in (not part of the saved draft: uploads expire after a day). */
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const kinds = CATEGORIES.filter((c) => live.includes(c.id) && (!invite || invite.categories.includes(c.id)));
  const [step, setStep] = useState(startStep);
  const heading = useRef<HTMLHeadingElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [state, action] = useActionState<PostState, FormData>(async (previous, form) => {
    const result = await postTask(previous, form);
    if (result.dealId) {
      try {
        localStorage.removeItem(draftKey);
      } catch { /* storage unavailable */ }
      router.replace(`/tasks/${result.dealId}`);
    }
    return result;
  }, {});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  /** A kind's "from" price on its card: "3,000₮-өөс" or, for hourly kinds, "6,000₮/цаг-аас". */
  const kindFrom = (c: CategoryId) => {
    const f = kindFromLabel(c, cfg);
    return f.hourly ? t("home.fromHourly", { amount: fmtMoney(f.amount) }) : t("home.from", { amount: fmtMoney(f.amount) });
  };

  // Draft: restore unless arriving with a prefilled title; save on every change (DESIGN §7).
  useEffect(() => {
    try {
      if (initial.title) return;
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<Draft>;
        // arriving by tapping a kind: a draft of another kind isn't this task — keep it saved, don't mix it in
        if (initial.category && draft.category && draft.category !== initial.category) return;
        // An unavailable draft must never be restored under another category.
        if (draft.category && (!live.includes(draft.category) || (invite && !invite.categories.includes(draft.category)))) return;
        setD((x) => ({ ...x, ...draft, description: draft.description || (draft.customTitle === undefined ? draft.title ?? "" : ""), customTitle: draft.customTitle ?? Boolean(draft.title) }));
      }
    } catch {
      /* storage unavailable */
    } finally {
      setDraftReady(true);
    }
  }, [initial.title, initial.category, invite, live, draftKey]);
  useEffect(() => {
    // Do not replace a stored request with the blank initial render before restoration finishes.
    if (!draftReady) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  }, [d, draftReady, draftKey]);
  useEffect(() => {
    if (state.step !== undefined) setStep(state.step);
  }, [state]);
  useEffect(() => {
    heading.current?.scrollIntoView({ block: "start" });
  }, [step]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const twoPoint = TWO_POINT_CATEGORIES.includes(d.category);
  const isCarry = d.category === "carry";
  const buys = categoryConfig(d.category).items;
  const posterChooses = customerChoosesHelper(d.category);
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
    variety: d.variety,
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
    autoPick: invite || posterChooses || d.when === "flexible" ? false : d.autoPick,
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
  // pre-filled with the suggested price (minimum × 1.25, Ops-editable — V1 spec C3); any price from the minimum
  const suggested = suggestedPrice(minFee, cfg);
  const fee = typed > 0 ? typed : suggested;
  const belowMin = typed > 0 && typed < minFee;
  // beyond the free active tasks the service fee is a little higher (same engine function as the server)
  const extraFee = extraTaskFeeFor(openTasks ?? 0, cfg);
  const itemBudget = buys && d.buyForMe ? Number(digits(d.itemBudget) || 0) : 0;
  // the "service & safety fee" is on the job total: price + shopping budget (V1 spec C4)
  const serviceFee = firstTask ? 0 : serviceFeeFor(fee, cfg, itemBudget) + extraFee;
  const overMax = fee + itemBudget > cfg.maxJobTotal;
  // What is held for items: the typed budget plus the optional +10% (engine rule, same function).
  const heldItems = heldItemBudget(itemBudget, details.budgetBuffer, cfg);
  const total = fee + heldItems + serviceFee;
  const stairs = quote.lines.find((l) => l.key === "stairs");
  const backLeg = quoteFee(d.category, { ...details, roundTrip: true }, cfg, startsAt).lines.find((l) => l.key === "roundTrip");
  const savedMatch = saved.find((a) => a.address === d.address.trim());
  const savedName = (a: SavedAddress) => (a.kind === "other" ? (a.label ?? a.address) : t(`task.saved.${a.kind}`));
  const brief = d.description;
  const title = d.customTitle && d.title.trim() ? d.title : titleFromBrief(brief, cfg.titleMax);
  const addressChoices: AddressChoice[] = [
    ...saved.map((a) => ({ id: a.id, label: savedName(a), address: a.address, kind: a.kind })),
    ...recent.map((address, i) => ({ id: `recent-${i}`, label: address, address, kind: "recent" as const })),
  ];
  const chooseAddress = (choice: AddressChoice, pickup = false) => {
    const a = saved.find((s) => s.id === choice.id);
    if (pickup) {
      setD((x) => ({ ...x, pickup: choice.address, pickupPin: a?.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null }));
    } else {
      setD((x) => ({ ...x, ...(a ? fromSaved(a) : { address: choice.address, pin: null, entrance: "", floor: "", unit: "", lift: null, note: "", saveAs: "" as const, showDetails: false }) }));
    }
  };
  const arrivalSummary = [d.entrance && t("details.entrance", { v: d.entrance }), d.floor && t("details.floor", { v: d.floor }), d.unit && t("details.unit", { v: d.unit })].filter(Boolean).join(" · ");

  let reason: string | null = null;
  if (STEPS[step] === "what" && !brief.trim()) reason = t("task.reasonWhat");
  if (STEPS[step] === "what" && pendingCondition.trim()) reason = t("conditions.finishAdding");
  if (STEPS[step] === "where") {
    if (!d.address.trim()) reason = t("task.reasonWhere");
    else if (d.when !== "now" && d.when !== "flexible" && (!start || (parseUbLocal(start) ?? 0) <= now)) reason = t("task.reasonTime");
    else if (buys && d.buyForMe && itemBudget <= 0) reason = t("task.reasonBudget");
  }
  if (STEPS[step] === "review" && belowMin) reason = t("post.reason.fee", { amount: fmtMoney(minFee) });
  if (STEPS[step] === "review" && overMax) reason = t("post.reason.overMax", { amount: fmtMoney(cfg.maxJobTotal) });

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
        { label: t("direct.money.feeNow"), amount: serviceFee - extraFee },
        ...(extraFee > 0 ? [{ label: t("post.extraTaskFee", { n: (openTasks ?? 0) + 1 }), amount: extraFee }] : []),
      ]
    : [
        { label: t("price.yourPrice"), amount: fee },
        ...(itemBudget > 0 ? [{ label: t("money.itemBudget"), amount: itemBudget }] : []),
        ...(heldItems > itemBudget ? [{ label: t("task.bufferLine"), amount: heldItems - itemBudget }] : []),
        firstTask
          ? { label: t("post.firstTaskFree"), amount: 0, muted: true }
          : { label: t("money.serviceFee"), amount: serviceFee - extraFee, muted: true },
        ...(extraFee > 0 && !firstTask ? [{ label: t("post.extraTaskFee", { n: (openTasks ?? 0) + 1 }), amount: extraFee, muted: true }] : []),
      ];

  return (
    <form
      action={action}
      className="flex flex-1 flex-col gap-5"
      onSubmit={(event) => {
        // Enter in an address field advances the form; only the review step can post the task.
        if (STEPS[step] !== "review") {
          event.preventDefault();
          if (!reason) setStep(step + 1);
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
            <button type="button" aria-label={t("common.back")} onClick={() => { setPendingCondition(""); setStep(step - 1); }} className="press flex h-11 w-11 items-center justify-center rounded-full bg-bg shadow-card">
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
        <h1 ref={heading} className="scroll-mt-24 text-[22px] font-bold leading-tight tracking-tight">{t(`task.steps.${STEPS[step]}`)}</h1>
        {invite && (
          <p className="flex items-center gap-2.5 rounded-card bg-brand-bg p-3 text-[14px] text-brand-ink">
            <Avatar name={invite.name} size={32} />
            <span className="min-w-0 flex-1">{t("invite.banner", { name: invite.name })}</span>
          </p>
        )}
      </header>

      {/* every answer travels with the final submit */}
      <input type="hidden" name="category" value={d.category} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="description" value={brief} />
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
                  setD((x) => ({ ...x, category: c.id, variety: x.category === c.id ? x.variety : undefined }));
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
          <button type="button" onClick={() => { setPendingCondition(""); setStep(0); }} className="press flex items-center gap-2 self-start rounded-full bg-brand-bg px-3 py-1.5 text-[13px] font-semibold text-brand-ink">
            <CategoryIcon id={d.category} size={16} />
            {t(`categoryShort.${d.category}`)} · {t("task.change")}
          </button>
          <TaskBrief category={d.category} value={brief} title={title} titleValue={d.customTitle ? d.title : title} maxLength={cfg.descriptionMax} titleMax={cfg.titleMax}
            onChange={(description) => setD((x) => ({ ...x, description, ...(!x.customTitle ? { title: "" } : {}) }))}
            onTitleChange={(title) => setD((x) => ({ ...x, title, customTitle: true }))} />
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t("varietyLabel")}</legend>
            <div className="flex flex-wrap gap-2">
              {JOB_VARIETIES[d.category].map(id => (
                <button key={id} type="button" aria-pressed={d.variety === id} className={chipClass(d.variety === id)}
                  onClick={() => set("variety", d.variety === id ? undefined : id)}>{t(`varieties.${id}`)}</button>
              ))}
            </div>
          </fieldset>
          <ConditionPicker variety={d.variety} category={d.category} value={d.require ?? {}} onChange={value => set("require", value)} pending={pendingCondition} setPending={setPendingCondition} />
          {/* no pictures on care tasks (children, elders) */}
          {categoryTrust(d.category) !== "care" && <TaskPhotoPicker value={photos} onChange={setPhotos} />}
          {categoryTrust(d.category) === "care" && <Note tone="warn">{t(d.category === "eldercare" ? "care.scopeElder" : "care.scopeChild")}</Note>}
          <details className="group text-[13px] text-ink-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2"><Info aria-hidden size={15} />{t("addressEntry.rules")}<ChevronDown aria-hidden size={14} className="ml-auto group-open:rotate-180" /></summary>
            <p className="pb-2 leading-relaxed">{t("post.rules")}</p>
          </details>
        </>
      )}

      {STEPS[step] === "where" && (
        <>
          <p className="-mt-2 text-[14px] leading-relaxed text-ink-2">{t("addressEntry.intro")}</p>
          <div className="flex flex-col gap-3">
            {twoPoint && <AddressInput
              label={t("task.pickup")} hint={t("addressEntry.pickupHelp")} placeholder={t("addressEntry.pickupExample")}
              value={d.pickup} pin={d.pickupPin} kind="pickup" optional choices={addressChoices}
              other={d.pin ? { ...d.pin, kind: "drop" } : null}
              onChange={(pickup) => setD((x) => ({ ...x, pickup, pickupPin: pickup.trim() === x.pickup.trim() ? x.pickupPin : null }))}
              onChoose={(choice) => chooseAddress(choice, true)} onPinChange={(pin) => set("pickupPin", pin)}
            />}
            <AddressInput
              label={twoPoint ? t("task.drop") : t("task.where")} hint={t("addressEntry.destinationHelp")} placeholder={t("addressEntry.destinationExample")}
              value={d.address} pin={d.pin} choices={addressChoices}
              other={twoPoint && d.pickupPin ? { ...d.pickupPin, kind: "pickup" } : null}
              onChange={(address) => setD((x) => ({ ...x, address, ...(address.trim() !== x.address.trim() ? { pin: null, entrance: "", floor: "", unit: "", lift: null, note: "", saveAs: "" } : {}) }))}
              onChoose={(choice) => chooseAddress(choice)} onPinChange={(pin) => set("pin", pin)}
            />
          </div>

          {d.showDetails || isCarry ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div><h2 className="font-semibold">{t("addressEntry.details")}</h2><p className="text-sm text-ink-2">{t("addressEntry.detailsHelp")}</p></div>
                {!isCarry && <button type="button" onClick={() => set("showDetails", false)} className="min-h-11 text-[13px] font-medium text-brand-ink">{t("addressEntry.hideDetails")}</button>}
              </div>
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
            <div className="flex flex-col gap-1">
              <DashedAdd label={t("addressEntry.details")} onClick={() => set("showDetails", true)} />
              {arrivalSummary && <p className="px-1 text-[13px] text-ink-2">{arrivalSummary}</p>}
            </div>
          )}

          {d.address.trim() && !savedMatch && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("task.saveAs")}</legend>
              <div className="flex gap-2" role="radiogroup">
                {(["home", "work", "other"] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={d.saveAs === k} onClick={() => set("saveAs", d.saveAs === k ? "" : k)} className={chipClass(d.saveAs === k)}>
                    <Ico as={KIND_ICON[k]} size={16} /> {t(`task.saved.${k}`)}
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
                <p className="rounded-input bg-fill px-4 py-3 text-[16px] font-medium"><Ico as={Ruler} /> {t("map.measured", { km: measuredKm.toFixed(1) })}</p>
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
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {(["now", "flexible", "today", "tomorrow", "pick"] as const).map((w) => (
                <button key={w} type="button" role="radio" aria-checked={d.when === w} onClick={() => set("when", w)} className={chipClass(d.when === w)}>
                  {w === "pick" ? <><Ico as={CalendarDays} size={16} />{" "}</> : ""}
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
          </fieldset>

          <details className="group rounded-card bg-bg shadow-card px-4" open={d.heavy || d.tools || undefined}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-[15px] font-medium text-ink-2">
              {t("addressEntry.extraOptions")}
              <span aria-hidden className="transition-transform group-open:rotate-180">▾</span>
            </summary>
            <p className="pb-3 text-sm text-ink-2">{t("addressEntry.extraHelp")}</p>
            <div className="mb-4 flex flex-col gap-3">
              <ToggleRow icon={<Weight aria-hidden size={24} />} title={t("task.heavy")} sub={t("price.heavySub", { amount: fmtMoney(cfg.heavyFee) })} checked={d.heavy} onChange={(v) => set("heavy", v)} />
              <ToggleRow icon={<Wrench aria-hidden size={24} />} title={t("price.tools")} sub={t("price.toolsSub", { amount: fmtMoney(cfg.toolsFee) })} checked={d.tools} onChange={(v) => set("tools", v)} />
            </div>
          </details>

          {isCarry && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("task.carryHow")}</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                <PriceDeltaCard
                  selected={d.carryByHelper}
                  onSelect={() => set("carryByHelper", true)}
                  icon={<Hand aria-hidden size={24} />}
                  title={t("task.carryHelper")}
                  sub={t("task.carryHelperSub")}
                  delta={stairs ? `+${fmtMoney(stairs.amount)}` : t("task.perFloor", { amount: fmtMoney(cfg.carryPerFloor) })}
                />
                <PriceDeltaCard selected={!d.carryByHelper} onSelect={() => set("carryByHelper", false)} icon={<DoorOpen aria-hidden size={24} />} title={t("task.carrySelf")} sub={t("task.carrySelfSub")} delta={`+${fmtMoney(0)}`} free />
              </div>
              {needTwo && <Note tone="warn">{t("task.needTwo")}</Note>}
            </fieldset>
          )}

          {buys && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("task.buyTitle")}</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                <PriceDeltaCard selected={d.buyForMe} onSelect={() => set("buyForMe", true)} icon={<Receipt aria-hidden size={24} />} title={t("task.buyForMe")} sub={t("task.buyForMeSub")} />
                <PriceDeltaCard selected={!d.buyForMe} onSelect={() => set("buyForMe", false)} icon={<ShoppingBag aria-hidden size={24} />} title={t("task.buySelf")} sub={t("task.buySelfSub")} delta={`+${fmtMoney(0)}`} free />
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
                  icon={<Receipt aria-hidden size={24} />}
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
          <div className="flex flex-col gap-2 rounded-card bg-bg shadow-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-ink-2">{t("addressEntry.reviewRequest")}</h2>
              <button type="button" onClick={() => setStep(1)} aria-label={t("addressEntry.editRequest")} className="flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-brand-ink"><PencilLine aria-hidden size={14} />{t("task.change")}</button>
            </div>
            <p className="text-sm text-ink-2">
              <CategoryIcon id={d.category} size={16} /> {t(`categoryShort.${d.category}`)} · {d.when === "now" ? t("task.whenNow") : d.when === "flexible" ? t("task.whenFlexible", { hours: Math.round(cfg.scheduleMatchWindowMinutes / 60) }) : start.replace("T", " ")}
            </p>
            <p className="text-[18px] font-semibold">{title}</p>
            <ConditionChips variety={d.variety} require={d.require} t={t} />
            {brief.trim() !== title.trim() && <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{brief}</p>}
          </div>
          <div className="flex flex-col gap-3 rounded-card bg-bg shadow-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-ink-2">{t("addressEntry.reviewPlaces")}</h2>
              <button type="button" onClick={() => setStep(2)} aria-label={t("addressEntry.editPlaces")} className="flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-brand-ink"><PencilLine aria-hidden size={14} />{t("task.change")}</button>
            </div>
            {twoPoint && d.pickup && <div className="flex items-start gap-2"><MapPin aria-hidden size={17} className="mt-1 flex-none" /><div><p className="text-xs text-ink-2">{t("task.pickup")}</p><p className="text-[15px]">{d.pickup}</p></div></div>}
            <div className="flex items-start gap-2"><MapPin aria-hidden size={17} className="mt-1 flex-none text-brand-ink" /><div><p className="text-xs text-ink-2">{twoPoint ? t("task.drop") : t("task.where")}</p><p className="text-[15px]">{d.address}</p>{arrivalSummary && <p className="text-sm text-ink-2">{arrivalSummary}</p>}{d.note && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{d.note}</p>}</div></div>
          </div>

          {isCarry && (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-[15px] font-medium text-ink-2">{t("task.team")}</legend>
              <OptionCard
                selected={d.people === 1}
                disabled={needTwo}
                onSelect={() => set("people", 1)}
                icon={<User aria-hidden size={24} />}
                title={t("task.oneHelper")}
                sub={needTwo ? t("task.tooHeavy") : undefined}
                price="" 
              />
              <OptionCard
                selected={d.people === 2}
                onSelect={() => set("people", 2)}
                icon={<Users aria-hidden size={24} />}
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
                  placeholder={fmtMoney(suggested).replace("₮", "")}
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
            {belowMin || overMax ? (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {belowMin ? t("post.reason.fee", { amount: fmtMoney(minFee) }) : t("post.reason.overMax", { amount: fmtMoney(cfg.maxJobTotal) })}
              </p>
            ) : (
              <p className="text-[13px] text-ink-2">{t("price.minHint", { min: fmtMoney(minFee), suggested: fmtMoney(suggested) })}</p>
            )}
            {/* care: what the price means per hour. Day jobs are priced per job, never per hour (contractor work, V1 spec A3) */}
            {hourly && d.category !== "dayjob" && details.minutes > 0 && (
              <p className="text-[13px] font-medium text-ink-2">
                {t("price.perHour", { amount: fmtMoney(Math.floor(fee / (details.minutes / 60))), floor: fmtMoney(hourly) })}
              </p>
            )}
            <p className="text-[13px] text-ink-2">{t("price.bargainHint")}</p>
          </div>

          {extraFee > 0 && <Note tone="info">{t("post.extraTaskNote", { n: openTasks, free: cfg.freeOpenTasks, amount: fmtMoney(extraFee) })}</Note>}
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
              icon={<Users aria-hidden size={24} />}
              title={t("invite.openAfter", { name: invite.name })}
              sub={t("invite.openAfterSub", { minutes: d.when === "now" ? cfg.inviteMinutes : cfg.inviteMinutesScheduled })}
              checked={openAfter}
              onChange={setOpenAfter}
            />
          ) : posterChooses ? <p className="rounded-input bg-fill p-3 text-sm">{t("care.posterChoice")}</p> : d.when === "flexible" ? null : (
            <ToggleRow icon={<Sparkles aria-hidden size={24} />} title={t("task.autoPick")} sub={t("task.autoPickSub", { minutes: cfg.autoPickMinutes })} checked={d.autoPick} onChange={(v) => set("autoPick", v)} />
          )}

          {posterChooses && invite && <p className="rounded-input bg-fill p-3 text-sm">{t("care.posterChoice")}</p>}
          {categoryConfig(d.category).checkHours && <p className="text-sm text-ink-2">{t("specialized.check", { hours: categoryConfig(d.category).checkHours! })}</p>}
          <p className="flex gap-2 rounded-input bg-held-bg p-3 text-[15px] text-held">
            <Lock aria-hidden size={14} className="shrink-0" />
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
            <button type="button" aria-label={t("common.back")} onClick={() => { setPendingCondition(""); setStep(step - 1); }} className={`${btn.square} bg-bg shadow-card`}>
              <ArrowLeft aria-hidden size={20} />
            </button>
          )}
          {STEPS[step] === "review" ? (
            <SubmitButton className={`${btn.primary} flex-1`} disabled={!!reason || Boolean(state.dealId)}>
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
