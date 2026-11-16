"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { setSaved } from "@/lib/helper-profile";
import { Uuid, parseOr } from "@/lib/input";

/** ♡ / ♥ on a helper profile. Shape-checked here; who may be saved is checked in `setSaved`. */
export async function toggleSaved(form: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const helperId = parseOr(Uuid, form.get("helperId"));
  if (!helperId) return;
  await setSaved(viewer.profile.id, helperId, form.get("on") === "1");
  refresh();
}
