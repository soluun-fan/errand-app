"use client";

import { CategoryIcon } from "@/components/category-icon";
import { OptionCard, ToggleRow } from "@/components/choice";
import { ConditionPicker } from "@/components/condition-picker";
import { ConditionChips } from "@/components/conditions";
import { MoneyBreakdown, type MoneyRow } from "@/components/money-breakdown";
import { SubmitButton } from "@/components/sheet";
import { TaskBrief } from "@/components/task-brief";
import { TaskPhotoPicker, type PickedPhoto } from "@/components/task-photo-picker";
import { Avatar, Note, btn, chipClass, field } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { SavedAddress } from "@/lib/addresses";
import { draftKeyFor } from "@/lib/draft";
import {
  CATEGORIES,
  TWO_POINT_CATEGORIES,
  categoryConfig,
  categoryTrust,
  customerChoosesHelper,
  extraTaskFeeFor,
  heldItemBudget,
  kindFromLabel,
  quoteFee,
  roadKm,
  serviceFeeFor,
  suggestedMinutes,
  suggestedPrice,
  taskMinFee,
  type CategoryId,
  type EngineConfig,
  type ErrandDetails,
} from "@/lib/engine";
import { JOB_VARIETIES } from "@/lib/engine/job-varieties";
import { fmtMoney, parseUbLocal } from "@/lib/format";
import { titleFromBrief } from "@/lib/task-brief";
import { ArrowLeft, ChevronDown, Info, Lock, MapPin, PencilLine, Sparkles, User, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import { postTask, type PostState } from "./actions";

import { STEPS, digits, fromSaved, startString, type Draft, type InviteTarget } from "./post-draft";
import { PostEffortStep } from "./post-effort-step";
import { PostLocationStep } from "./post-location-step";
export type { Draft, InviteTarget } from "./post-draft";
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
    if (result.step !== undefined) setStep(result.step);
    if (result.dealId) {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* storage unavailable */
      }
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
  /* eslint-disable react-hooks/set-state-in-effect -- Restore browser draft data before enabling persistence; do not overwrite it during hydration. */
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
        setD((x) => ({
          ...x,
          ...draft,
          description: draft.description || (draft.customTitle === undefined ? (draft.title ?? "") : ""),
          customTitle: draft.customTitle ?? Boolean(draft.title),
        }));
      }
    } catch {
      /* storage unavailable */
    } finally {
      setDraftReady(true);
    }
  }, [initial.title, initial.category, invite, live, draftKey]);
  /* eslint-enable react-hooks/set-state-in-effect */
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
  const usualMinutes = cfg.kindMinutes[d.category] ?? cfg.includedMinutes;
  // "About how long?" follows the trip: the usual time plus travel there (and back), unless picked
  const autoMinutes = Math.min(care ? cfg.careMaxMinutes : 480, suggestedMinutes(usualMinutes, tripKm, twoPoint && d.roundTrip, cfg));
  const travelMinutes = Math.round(tripKm * cfg.travelMinPerKm * (twoPoint && d.roundTrip ? 2 : 1));
  const requestedDetails: ErrandDetails = {
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
  const requestedQuote = quoteFee(d.category, requestedDetails, cfg, startsAt);
  const needTwo = requestedQuote.peopleRequired === 2;
  const details: ErrandDetails = { ...requestedDetails, people: needTwo ? 2 : d.people };
  const quote = details.people === requestedDetails.people ? requestedQuote : quoteFee(d.category, details, cfg, startsAt);

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
  const savedMatch = saved.find((a) => a.address === d.address.trim());
  const brief = d.description;
  const title = d.customTitle && d.title.trim() ? d.title : titleFromBrief(brief, cfg.titleMax);
  const arrivalSummary = [
    d.entrance && t("details.entrance", { v: d.entrance }),
    d.floor && t("details.floor", { v: d.floor }),
    d.unit && t("details.unit", { v: d.unit }),
  ]
    .filter(Boolean)
    .join(" · ");

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
        ...(extraFee > 0 && !firstTask
          ? [{ label: t("post.extraTaskFee", { n: (openTasks ?? 0) + 1 }), amount: extraFee, muted: true }]
          : []),
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
            <Link
              href="/"
              aria-label={t("task.close")}
              className="press flex h-11 w-11 items-center justify-center rounded-full bg-bg shadow-card"
            >
              <X aria-hidden size={20} />
            </Link>
          ) : (
            <button
              type="button"
              aria-label={t("common.back")}
              onClick={() => {
                setPendingCondition("");
                setStep(step - 1);
              }}
              className="press flex h-11 w-11 items-center justify-center rounded-full bg-bg shadow-card"
            >
              <ArrowLeft aria-hidden size={20} />
            </button>
          )}
          <span className="text-[13px] font-semibold text-ink-2 tabular-nums">
            {step + 1} / {STEPS.length}
          </span>
        </div>
        <span aria-hidden className="h-1 overflow-hidden rounded-full bg-line">
          <span
            className="block h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </span>
        <h1 ref={heading} className="scroll-mt-24 text-[22px] font-bold leading-tight tracking-tight">
          {t(`task.steps.${STEPS[step]}`)}
        </h1>
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
          <button
            type="button"
            onClick={() => {
              setPendingCondition("");
              setStep(0);
            }}
            className="press flex items-center gap-2 self-start rounded-full bg-brand-bg px-3 py-1.5 text-[13px] font-semibold text-brand-ink"
          >
            <CategoryIcon id={d.category} size={16} />
            {t(`categoryShort.${d.category}`)} · {t("task.change")}
          </button>
          <TaskBrief
            category={d.category}
            value={brief}
            title={title}
            titleValue={d.customTitle ? d.title : title}
            maxLength={cfg.descriptionMax}
            titleMax={cfg.titleMax}
            onChange={(description) => setD((x) => ({ ...x, description, ...(!x.customTitle ? { title: "" } : {}) }))}
            onTitleChange={(title) => setD((x) => ({ ...x, title, customTitle: true }))}
          />
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t("varietyLabel")}</legend>
            <div className="flex flex-wrap gap-2">
              {JOB_VARIETIES[d.category].map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={d.variety === id}
                  className={chipClass(d.variety === id)}
                  onClick={() => set("variety", d.variety === id ? undefined : id)}
                >
                  {t(`varieties.${id}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <ConditionPicker
            variety={d.variety}
            category={d.category}
            value={d.require ?? {}}
            onChange={(value) => set("require", value)}
            pending={pendingCondition}
            setPending={setPendingCondition}
          />
          {/* no pictures on care tasks (children, elders) */}
          {categoryTrust(d.category) !== "care" && <TaskPhotoPicker value={photos} onChange={setPhotos} />}
          {categoryTrust(d.category) === "care" && (
            <Note tone="warn">{t(d.category === "eldercare" ? "care.scopeElder" : "care.scopeChild")}</Note>
          )}
          <details className="group text-[13px] text-ink-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2">
              <Info aria-hidden size={15} />
              {t("addressEntry.rules")}
              <ChevronDown aria-hidden size={14} className="ml-auto group-open:rotate-180" />
            </summary>
            <p className="pb-2 leading-relaxed">{t("post.rules")}</p>
          </details>
        </>
      )}

      {STEPS[step] === "where" && (
        <>
          <PostLocationStep d={d} setD={setD} saved={saved} recent={recent} arrivalSummary={arrivalSummary} />
          <PostEffortStep
            d={d}
            setD={setD}
            cfg={cfg}
            details={details}
            measuredKm={measuredKm}
            startsAt={startsAt}
            now={now}
            travelMinutes={travelMinutes}
            autoMinutes={autoMinutes}
            quote={quote}
          />
        </>
      )}

      {STEPS[step] === "review" && (
        <>
          {startStep === STEPS.indexOf("review") && <Note tone="info">{t("task.repeatNote")}</Note>}
          <div className="flex flex-col gap-2 rounded-card bg-bg shadow-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-ink-2">{t("addressEntry.reviewRequest")}</h2>
              <button
                type="button"
                onClick={() => setStep(1)}
                aria-label={t("addressEntry.editRequest")}
                className="flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-brand-ink"
              >
                <PencilLine aria-hidden size={14} />
                {t("task.change")}
              </button>
            </div>
            <p className="text-sm text-ink-2">
              <CategoryIcon id={d.category} size={16} /> {t(`categoryShort.${d.category}`)} ·{" "}
              {d.when === "now"
                ? t("task.whenNow")
                : d.when === "flexible"
                  ? t("task.whenFlexible", { hours: Math.round(cfg.scheduleMatchWindowMinutes / 60) })
                  : start.replace("T", " ")}
            </p>
            <p className="text-[18px] font-semibold">{title}</p>
            <ConditionChips variety={d.variety} require={d.require} t={t} />
            {brief.trim() !== title.trim() && <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{brief}</p>}
          </div>
          <div className="flex flex-col gap-3 rounded-card bg-bg shadow-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-ink-2">{t("addressEntry.reviewPlaces")}</h2>
              <button
                type="button"
                onClick={() => setStep(2)}
                aria-label={t("addressEntry.editPlaces")}
                className="flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-brand-ink"
              >
                <PencilLine aria-hidden size={14} />
                {t("task.change")}
              </button>
            </div>
            {twoPoint && d.pickup && (
              <div className="flex items-start gap-2">
                <MapPin aria-hidden size={17} className="mt-1 flex-none" />
                <div>
                  <p className="text-xs text-ink-2">{t("task.pickup")}</p>
                  <p className="text-[15px]">{d.pickup}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <MapPin aria-hidden size={17} className="mt-1 flex-none text-brand-ink" />
              <div>
                <p className="text-xs text-ink-2">{twoPoint ? t("task.drop") : t("task.where")}</p>
                <p className="text-[15px]">{d.address}</p>
                {arrivalSummary && <p className="text-sm text-ink-2">{arrivalSummary}</p>}
                {d.note && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{d.note}</p>}
              </div>
            </div>
          </div>

          {isCarry && (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-[15px] font-medium text-ink-2">{t("task.team")}</legend>
              <OptionCard
                selected={details.people === 1}
                disabled={needTwo}
                onSelect={() => set("people", 1)}
                icon={<User aria-hidden size={24} />}
                title={t("task.oneHelper")}
                sub={needTwo ? t("task.tooHeavy") : undefined}
                price=""
              />
              <OptionCard
                selected={details.people === 2}
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
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[20px] font-bold text-brand-ink"
                >
                  ₮
                </span>
              </span>
              <button
                type="button"
                aria-label={t("task.raise")}
                onClick={() => set("price", String(fee + cfg.feeStep))}
                className={btn.square}
              >
                +
              </button>
            </div>
            {belowMin || overMax ? (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {belowMin
                  ? t("post.reason.fee", { amount: fmtMoney(minFee) })
                  : t("post.reason.overMax", { amount: fmtMoney(cfg.maxJobTotal) })}
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

          {extraFee > 0 && (
            <Note tone="info">{t("post.extraTaskNote", { n: openTasks, free: cfg.freeOpenTasks, amount: fmtMoney(extraFee) })}</Note>
          )}
          <details className="group">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-[15px] font-medium">
              {t("task.breakdown")}
              <span aria-hidden className="transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <MoneyBreakdown
              rows={breakdown}
              total={
                direct ? { label: t("direct.money.payWhenChosen"), amount: serviceFee } : { label: t("money.totalHeld"), amount: total }
              }
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
          ) : posterChooses ? (
            <p className="rounded-input bg-fill p-3 text-sm">{t("care.posterChoice")}</p>
          ) : d.when === "flexible" ? null : (
            <ToggleRow
              icon={<Sparkles aria-hidden size={24} />}
              title={t("task.autoPick")}
              sub={t("task.autoPickSub", { minutes: cfg.autoPickMinutes })}
              checked={d.autoPick}
              onChange={(v) => set("autoPick", v)}
            />
          )}

          {posterChooses && invite && <p className="rounded-input bg-fill p-3 text-sm">{t("care.posterChoice")}</p>}
          {cfg.kindCheckHours[d.category] && (
            <p className="text-sm text-ink-2">{t("specialized.check", { hours: cfg.kindCheckHours[d.category]! })}</p>
          )}
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
            <button
              type="button"
              aria-label={t("common.back")}
              onClick={() => {
                setPendingCondition("");
                setStep(step - 1);
              }}
              className={`${btn.square} bg-bg shadow-card`}
            >
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
