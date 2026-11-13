"use server";

import type { ActionResult } from "@/components/sheet";

/** Gallery sheets open and validate like the real ones, but never change anything. */
export async function galleryAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return { error: `Gallery: "${String(form.get("intent"))}" would run here. Nothing was changed.` };
}
