"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { deleteAddress } from "@/lib/addresses";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { OPEN_CATEGORIES, type CategoryId } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";

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
