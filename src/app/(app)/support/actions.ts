"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { maskContacts } from "@/lib/chat-rules";
import { sendSupportRequest } from "@/lib/support";
import { checkSupport } from "@/lib/support-rules";

/** "Message our team" (2026-11-23). */
export async function sendSupport(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  const c = checkSupport(String(form.get("topic") ?? ""), String(form.get("message") ?? ""));
  if (!c.ok) return { error: t(c.reason === "short" ? "support.short" : c.reason === "long" ? "support.long" : "error.generic") };
  // numbers and links people type are masked like chat; Ops already sees the sender's phone
  const r = await sendSupportRequest(viewer.profile.id, c.topic, maskContacts(c.message).text);
  return r === "limit" ? { error: t("support.limit") } : { done: true };
}
