"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { acknowledgeIncident, resolveIncident } from "@/lib/incidents";
import { updatePricing, type PricingSettings } from "@/lib/pricing";
import { cleanTiers, percentToBps, wholeAmount } from "@/lib/pricing-rules";
import { updateControls } from "@/lib/safety";
import { deleteQuickStart, saveKeywords, saveQuickStart } from "@/lib/content";
import { MAX_KEYWORDS, QuickStartInput, parseKeywords } from "@/lib/content-rules";
import { CATEGORIES, type CategoryId } from "@/lib/engine";
import { Uuid, parseOr } from "@/lib/input";
import { decideCertificate, decideOrganization, setCategoryLive } from "@/lib/orgs";

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
    priceDownBps: percentToBps(form.get("priceDownPct"), 50),
    priceUpBps: percentToBps(form.get("priceUpPct"), 100),
    counterUpBps: percentToBps(form.get("counterUpPct"), 100),
    serviceFeeTiers: cleanTiers(rawTiers),
  };
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
  if (!CATEGORIES.some((c) => c.id === category)) return { error: t("error.generic") };
  const live = form.get("live") === "1";
  const care = CATEGORIES.find((c) => c.id === category)?.trust === "care";
  if (live && care && form.get("legalReviewed") !== "on") return { error: t("specialized.legalNeeded") };
  await setCategoryLive(viewer.profile.id, category, live);
  refresh();
  return { done: true };
}
