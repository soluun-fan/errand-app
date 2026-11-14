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
