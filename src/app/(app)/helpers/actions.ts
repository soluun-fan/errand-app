"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtMoney } from "@/lib/format";
import { setListing, setSaved } from "@/lib/helper-profile";
import { Uuid, parseOr } from "@/lib/input";
import { parsePrice } from "@/lib/price-input";
import { getPricing } from "@/lib/pricing";
import { BIO_MAX } from "@/lib/profile-rules";

/** ♡ / ♥ on a helper profile. Shape-checked here; who may be saved is checked in `setSaved`. */
export async function toggleSaved(form: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const helperId = parseOr(Uuid, form.get("helperId"));
  if (!helperId) return;
  await setSaved(viewer.profile.id, helperId, form.get("on") === "1");
  refresh();
}

/**
 * A helper's own listing: intro (contacts masked) and an optional "from" price, at least today's
 * minimum. Approved helpers only, and only their own profile.
 */
export async function saveListing(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (!viewer.actor.helperApproved) return { error: t("error.forbidden") };
  const raw = String(form.get("bio") ?? "");
  if (raw.trim().length > BIO_MAX) return { error: t("listing.tooLong", { n: BIO_MAX }) };
  const typed = String(form.get("fromPrice") ?? "").trim();
  let fromPrice: number | null = null;
  if (typed) {
    fromPrice = parsePrice(typed);
    const min = (await getPricing()).baseFee;
    if (fromPrice === null || fromPrice < min || fromPrice > 10_000_000) return { error: t("listing.priceInvalid", { min: fmtMoney(min) }) };
  }
  // phones / links are masked when saved (the sheet says so up front); contact stays in the app
  await setListing(viewer.profile.id, { bio: raw, fromPrice });
  refresh();
  return { done: true };
}
