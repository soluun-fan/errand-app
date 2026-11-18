"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getViewer } from "@/lib/auth";
import { recordAcceptance } from "@/lib/legal";

/** A helper accepts the current Helper service agreement (recorded with its version). */
export async function acceptHelperTerms(_prev: ActionResult, _form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/helper-terms");
  await recordAcceptance(viewer.profile.id, "helper");
  return { done: true };
}
