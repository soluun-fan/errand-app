"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { MODE_COOKIE } from "@/lib/mode-cookie";
import { clearPendingLogin } from "@/lib/verify-mn-login";
import { redirect } from "next/navigation";
import { deleteAddress } from "@/lib/addresses";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { OPEN_CATEGORIES, type CategoryId } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { closeAccount, closeBlocks } from "@/lib/legal";
import { createClient } from "@/lib/supabase/server";

/** Remove a saved address. RLS limits the delete to the viewer's own rows. */
export async function removeAddress(form: FormData): Promise<void> {
  if (!(await getViewer())) redirect("/login");
  const id = String(form.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await deleteAddress(id);
  refresh();
}

/**
 * An approved helper chooses which everyday kinds of work they take (new kinds appear over time).
 * Specialized kinds are never set here: they come from organisations and checked certificates.
 */
export async function setWorkKinds(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (!viewer.actor.helperApproved) return { error: t("error.forbidden") };
  const kinds = [...new Set(form.getAll("kinds").map(String))].filter((c): c is CategoryId => OPEN_CATEGORIES.includes(c as CategoryId));
  if (!kinds.length) return { error: t("workKinds.pickOne") };
  await createAdminClient().from("profiles").update({ categories: kinds }).eq("id", viewer.profile.id).eq("role", "helper").throwOnError();
  refresh();
  return { done: true };
}

/** "Add them all": the everyday kinds the helper hasn't picked yet, added in one tap. */
export async function addWorkKinds(raw: readonly string[]): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (!viewer.actor.helperApproved || !Array.isArray(raw)) return { error: t("error.forbidden") };
  const add = raw.filter((c): c is CategoryId => OPEN_CATEGORIES.includes(c as CategoryId));
  const kinds = [...new Set([...(viewer.actor.categories ?? []), ...add])];
  await createAdminClient().from("profiles").update({ categories: kinds }).eq("id", viewer.profile.id).eq("role", "helper").throwOnError();
  refresh();
  return {};
}

/**
 * Close my account (docs/decisions.md 2026-11-18 "Registration and terms"). Only when nothing is
 * running: no active tasks, no earnings still owed, no open "not paid" report. The person types the
 * confirmation word so it can't happen by a mis-tap.
 */
export async function closeMyAccount(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== t("closeAccount.word").toLowerCase()) return { error: t("closeAccount.typeWord", { word: t("closeAccount.word") }) };
  const blocks = await closeBlocks(viewer.profile.id, viewer.profile.role);
  if (blocks.length) return { error: blocks.map((b) => t(`closeAccount.block.${b}`)).join(" ") };
  if (!(await closeAccount(viewer.profile.id))) return { error: t("error.generic") };
  await (await createClient()).auth.signOut();
  (await cookies()).delete(MODE_COOKIE);
  await clearPendingLogin();
  redirect("/welcome?closed=1");
}
