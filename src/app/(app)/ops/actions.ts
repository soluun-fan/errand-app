"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { acknowledgeIncident, resolveIncident } from "@/lib/incidents";
import { updateKindMinimum, updatePricing, type PricingSettings } from "@/lib/pricing";
import { cleanTiers, percentToBps, wholeAmount } from "@/lib/pricing-rules";
import { audit, updateControls } from "@/lib/safety";
import { deleteQuickStart, saveKeywords, saveQuickStart } from "@/lib/content";
import { MAX_KEYWORDS, QuickStartInput, parseKeywords } from "@/lib/content-rules";
import { CATEGORIES, type CategoryId } from "@/lib/engine";
import { Uuid, parseOr } from "@/lib/input";
import { decideCertificate, decideOrganization, setCategoryLive } from "@/lib/orgs";
import { createCoverSlot, setCover } from "@/lib/covers";
import { updateRules, type PlatformRules } from "@/lib/rules";
import { resolveUnpaid } from "@/lib/direct-pay";
import { decideBadge } from "@/lib/badges";
import { decideWithdrawal, markAccountChecked } from "@/lib/withdrawals";
import { resolveError } from "@/lib/error-log";
import type { Wave } from "@/lib/dispatch/plan";

async function requireAdmin() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer.profile.role === "admin" ? viewer : null;
}

const money = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[\s,₮]/g, ""));
  return Number.isInteger(n) && n > 0 && n <= 1_000_000_000 ? n : null;
};

/** /ops/safety: pause switches and caps. Every save is in the Ops audit log. */
export async function saveControls(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const maxDealAmount = money(form.get("maxDealAmount"));
  const maxCustomerDaily = money(form.get("maxCustomerDaily"));
  const maxTotalHeld = money(form.get("maxTotalHeld"));
  const maxOpenTasks = Number(form.get("maxOpenTasks"));
  if (!maxDealAmount || !maxCustomerDaily || !maxTotalHeld || !Number.isInteger(maxOpenTasks) || maxOpenTasks < 1 || maxOpenTasks > 50) {
    return { error: t("opsSafety.invalid") };
  }
  const postingPaused = form.get("postingPaused") === "on";
  const paymentsPaused = form.get("paymentsPaused") === "on";
  const pauseNote = String(form.get("pauseNote") ?? "").trim().slice(0, 300) || null;
  if ((postingPaused || paymentsPaused) && !pauseNote) return { error: t("opsSafety.noteNeeded") };
  await updateControls(viewer.profile.id, { postingPaused, paymentsPaused, pauseNote, maxDealAmount, maxCustomerDaily, maxTotalHeld, maxOpenTasks });
  refresh();
  return { done: true };
}

export async function acknowledge(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  if (!(await acknowledgeIncident(String(form.get("id") ?? ""), viewer.profile.id))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}

export async function resolve(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);
  if (note.length < 5) return { error: t("opsIncidents.noteNeeded") };
  if (!(await resolveIncident(String(form.get("id") ?? ""), viewer.profile.id, note))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}

/** /ops/pricing: the live price list. Applies to tasks posted from now on; logged. */
export async function savePricing(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const amt = (k: string, min = 0, max = 100_000) => wholeAmount(form.get(k), min, max);
  const n = Number(form.get("tierCount"));
  const rawTiers = Number.isInteger(n) && n >= 1 && n <= 8
    ? Array.from({ length: n }, (_, i) => ({
        below: i === n - 1 ? null : amt(`tierBelow${i}`, 1, 100_000_000),
        fee: amt(`tierFee${i}`),
      }))
    : null;
  const next = {
    baseFee: amt("baseFee", 1000),
    includedMinutes: amt("includedMinutes", 0, 240),
    includedKm: amt("includedKm", 0, 20),
    perHalfHour: amt("perHalfHour"),
    perKm: amt("perKm"),
    heavyFee: amt("heavyFee"),
    carryPerFloor: amt("carryPerFloor"),
    toolsFee: amt("toolsFee"),
    nightFee: amt("nightFee"),
    roundTripBps: percentToBps(form.get("roundTripPct"), 100),
    travelMinPerKm: amt("travelMinPerKm", 0, 15),
    cancelFee: amt("cancelFee", 0, 100_000),
    freeOpenTasks: amt("freeOpenTasks", 1, 50),
    extraTaskFee: amt("extraTaskFee", 0, 100_000),
    priceDownBps: percentToBps(form.get("priceDownPct"), 50),
    priceUpBps: percentToBps(form.get("priceUpPct"), 100),
    counterUpBps: percentToBps(form.get("counterUpPct"), 100),
    serviceFeeTiers: cleanTiers(rawTiers),
    suggestBps: percentToBps(form.get("suggestPct"), 300),
    maxJobTotal: amt("maxJobTotal", 5000, 10_000_000),
  };
  if (next.suggestBps !== null && next.suggestBps < 10_000) return { error: t("opsPricing.invalid") }; // never below the minimum
  if (Object.values(next).some((v) => v === null) || (next.includedMinutes as number) % 30 !== 0) {
    return { error: t("opsPricing.invalid") };
  }
  await updatePricing(viewer.profile.id, next as PricingSettings);
  refresh();
  return { done: true };
}

/* ---------- /ops/content: quick starts and search words (no deploy needed) ---------- */

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export async function saveQuickStartAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const parsed = QuickStartInput.safeParse({
    id: String(form.get("id") ?? "") || null,
    kind: form.get("kind"),
    category: form.get("category"),
    titleMn: String(form.get("titleMn") ?? ""),
    titleEn: String(form.get("titleEn") ?? ""),
    months: MONTHS.filter((m) => form.get(`m${m}`) === "on"),
    sort: Number(form.get("sort") ?? 0),
    active: form.get("active") === "on",
  });
  if (!parsed.success) return { error: t("opsContent.invalid") };
  await saveQuickStart(viewer.profile.id, parsed.data);
  refresh();
  return { done: true };
}

export async function deleteQuickStartAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const id = parseOr(Uuid, form.get("id"));
  if (!id) return { error: t("error.generic") };
  await deleteQuickStart(viewer.profile.id, id);
  refresh();
  return { done: true };
}

export async function saveKeywordsAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const category = String(form.get("category") ?? "") as CategoryId;
  if (category === "other" || !CATEGORIES.some((c) => c.id === category)) return { error: t("error.generic") };
  const words = parseKeywords(String(form.get("words") ?? ""));
  if (!words) return { error: t("opsContent.wordsInvalid", { n: MAX_KEYWORDS }) };
  await saveKeywords(viewer.profile.id, category, words);
  refresh();
  return { done: true };
}

/* ---------- specialized work: organisations, certificates, kinds on/off ---------- */

export async function decideOrgAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const id = parseOr(Uuid, form.get("id"));
  const status = String(form.get("status") ?? "");
  if (!id || !["approved", "rejected", "suspended"].includes(status)) return { error: t("error.generic") };
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  if (status !== "approved" && !note) return { error: t("opsOrgs.noteNeeded") };
  const kinds = form.getAll("categories").map(String) as CategoryId[];
  const ok = await decideOrganization(viewer.profile.id, id, status as "approved" | "rejected" | "suspended", kinds, note);
  if (!ok) return { error: t("opsOrgs.pickKinds") };
  refresh();
  return { done: true };
}

export async function decideCertAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const id = parseOr(Uuid, form.get("id"));
  const approve = form.get("approve") === "1";
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  if (!id) return { error: t("error.generic") };
  if (!approve && !note) return { error: t("opsOrgs.noteNeeded") };
  if (!(await decideCertificate(viewer.profile.id, id, approve, note))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}

export async function setLiveAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const category = String(form.get("category") ?? "") as CategoryId;
  if (!CATEGORIES.some((c) => c.id === category && c.trust !== "care")) return { error: t("specialized.unavailable") };
  const live = form.get("live") === "1";
  await setCategoryLive(viewer.profile.id, category, live);
  refresh();
  return { done: true };
}

/* ---------- cover photos per kind (docs/decisions.md 2026-11-17 "Pictures") ---------- */

const kindOf = (v: unknown): CategoryId | null => (typeof v === "string" && CATEGORIES.some((c) => c.id === v) ? (v as CategoryId) : null);

/** Step 1: a signed upload URL for a kind's cover (JPEG, ≤ 5 MB; re-encoded in the browser). */
export async function prepareCover(rawCategory: string, bytes: number): Promise<{ path: string; token: string } | { error: string }> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const category = kindOf(rawCategory);
  if (!category || typeof bytes !== "number" || !(bytes > 0 && bytes <= 5 * 1024 * 1024)) return { error: t("taskPhotos.tooBig") };
  return createCoverSlot(category);
}

/** Step 2: use the uploaded file as the kind's cover — or clear it (path null). */
export async function saveCover(rawCategory: string, path: string | null): Promise<{ error?: string }> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const category = kindOf(rawCategory);
  if (!category || (path !== null && (typeof path !== "string" || path.length > 120))) return { error: t("error.generic") };
  if (!(await setCover(viewer.profile.id, category, path))) return { error: t("taskPhotos.failed") };
  refresh();
  return {};
}

/* ---------- per-kind minimum price (docs/decisions.md 2026-11-17 "Minimum per kind") ---------- */

/** One kind's floor: general (the base price), a fixed minimum, or an hourly minimum × hours. */
export async function saveKindMinimum(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const category = String(form.get("category") ?? "") as CategoryId;
  if (!CATEGORIES.some((c) => c.id === category)) return { error: t("error.generic") };
  const mode = String(form.get("mode") ?? "");
  const amount = wholeAmount(form.get("amount"), 1000, mode === "hourly" ? 200_000 : 1_000_000);
  if (mode !== "general" && (amount === null || amount % 500 !== 0)) return { error: t("opsPricing.invalid") };
  await updateKindMinimum(viewer.profile.id, {
    category,
    minFee: mode === "fixed" ? amount : null,
    minHourly: mode === "hourly" ? amount : null,
  });
  refresh();
  return { done: true };
}

/* ---------- rules: timings and limits (docs/decisions.md 2026-11-18 "Rules from the database") ---------- */

/** Each field with its allowed range (the database checks the same ranges). */
const RULE_RANGES: Record<Exclude<keyof PlatformRules, "dispatchWaves" | "payMode">, [number, number]> = {
  paymentWindowMinutes: [3, 60],
  paymentWindowBookedMinutes: [5, 240],
  withdrawMin: [0, 100000],
  withdrawalsPerDay: [1, 20],
  autoPayoutDays: [1, 365],
  dayjobPairMonthCap: [1, 31],
  backOutGraceMinutes: [0, 60],
  nowMatchWindowMinutes: [10, 240],
  scheduleMatchWindowHours: [1, 168],
  applicationMinutes: [5, 240],
  autoPickMinutes: [1, 60],
  inviteMinutes: [5, 120],
  inviteMinutesScheduled: [15, 1440],
  maxApplicants: [1, 20],
  checkHours: [2, 168],
  pauseDaysFirst: [0, 30],
  pauseDaysSecond: [0, 60],
  pauseDaysMore: [0, 90],
  carePauseDays: [0, 90],
  careDayStartHour: [0, 23],
  careDayEndHour: [1, 24],
  careMaxMinutes: [60, 720],
  careCallMinSeconds: [10, 600],
};

export async function saveRules(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const next: Partial<PlatformRules> = {};
  for (const [k, [lo, hi]] of Object.entries(RULE_RANGES) as [keyof typeof RULE_RANGES, [number, number]][]) {
    const v = wholeAmount(form.get(k), lo, hi);
    if (v === null) return { error: t("opsRules.invalid", { field: t(`opsRules.f.${k}`), lo, hi }) };
    next[k] = v;
  }
  const r = next as PlatformRules;
  if (r.careMaxMinutes % 30 !== 0 || r.careDayStartHour >= r.careDayEndHour) return { error: t("opsRules.careInvalid") };
  if (!(r.pauseDaysFirst <= r.pauseDaysSecond && r.pauseDaysSecond <= r.pauseDaysMore)) return { error: t("opsRules.pausesInvalid") };
  const count = Number(form.get("waveCount"));
  if (!Number.isInteger(count) || count < 1 || count > 8) return { error: t("opsRules.wavesInvalid") };
  const waves = Array.from({ length: count }, (_, i) => ({
    radiusKm: wholeAmount(form.get(`waveKm${i}`), 1, 1000),
    max: wholeAmount(form.get(`waveMax${i}`), 1, 200),
    seconds: wholeAmount(form.get(`waveSec${i}`), 0, 3600),
  }));
  if (waves.some((w) => w.radiusKm === null || w.max === null || w.seconds === null)) return { error: t("opsRules.wavesInvalid") };
  const clean = waves as Wave[];
  if (clean.some((w, i) => i > 0 && w.radiusKm < clean[i - 1].radiusKm)) return { error: t("opsRules.wavesInvalid") };
  r.dispatchWaves = clean;
  r.payMode = form.get("payMode") === "direct" ? "direct" : "held";
  await updateRules(viewer.profile.id, r);
  refresh();
  return { done: true };
}

/* ---------- payments: "not paid" reports (docs/decisions.md 2026-11-18 "Direct pay + wire.mn") ---------- */

export async function resolveUnpaidAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const dealId = parseOr(Uuid, String(form.get("dealId") ?? ""));
  const note = String(form.get("note") ?? "").trim();
  if (!dealId || note.length < 3) return { error: t("opsPay.noteNeeded") };
  if (!(await resolveUnpaid(dealId, viewer.profile.id, note))) return { error: t("error.changed") };
  await audit(viewer.profile.id, "payments.unpaidResolved", dealId, { note });
  refresh();
  return { done: true };
}

/* ---------- driver's licence / car checks (docs/decisions.md 2026-11-18 "Task conditions") ---------- */

export async function decideBadgeAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const id = parseOr(Uuid, String(form.get("id") ?? ""));
  if (!id) return { error: t("error.generic") };
  const approve = form.get("approve") === "1";
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  if (!(await decideBadge(viewer.profile.id, id, approve, note))) return { error: t("error.changed") };
  await audit(viewer.profile.id, approve ? "badge.approve" : "badge.reject", id, { note });
  refresh();
  return { done: true };
}

/* ---------- withdrawals (owner's V1 Master Spec C10) ---------- */

/** Ops sent a withdrawal from the bank app ("sent") or couldn't ("failed": the money goes back to the helper's earnings). */
export async function decideWithdrawalAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const id = parseOr(Uuid, String(form.get("id") ?? ""));
  const sent = form.get("sent") === "1";
  if (!["0", "1"].includes(String(form.get("sent")))) return { error: t("error.generic") };
  const note = String(form.get("note") ?? "").trim().slice(0, 300) || null;
  const bankReference = String(form.get("bankReference") ?? "").trim();
  if (!id) return { error: t("error.generic") };
  if (!sent && !note) return { error: t("opsWithdraw.noteNeeded") };
  if (sent && (bankReference.length < 3 || bankReference.length > 120)) return { error: t("opsWithdraw.referenceNeeded") };
  if (!(await decideWithdrawal(id, viewer.profile.id, sent, note, bankReference))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}

/** Ops independently looked up the account at the bank and records the supporting reference. */
export async function checkAccountAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const userId = parseOr(Uuid, String(form.get("userId") ?? ""));
  if (!userId) return { error: t("error.changed") };
  const result = await markAccountChecked(userId, viewer.profile.id, {
    updatedAt: String(form.get("accountUpdatedAt") ?? ""),
    bankHolderName: String(form.get("bankHolderName") ?? ""),
    reference: String(form.get("bankReference") ?? ""),
  });
  if (result === "changed") return { error: t("error.changed") };
  if (result !== "ok") return { error: t(`opsWithdraw.checkError.${result}`) };
  refresh();
  return { done: true };
}

/* ---------- error log (docs/decisions.md 2026-11-18 "Launch readiness") ---------- */

export async function resolveErrorAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await requireAdmin();
  if (!viewer) return { error: t("ops.notAdmin") };
  const fp = String(form.get("fingerprint") ?? "");
  if (!/^[0-9a-f]{16,64}$/.test(fp) || !(await resolveError(fp, viewer.profile.id))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}
