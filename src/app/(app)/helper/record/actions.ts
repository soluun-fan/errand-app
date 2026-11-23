"use server";

import { refresh } from "next/cache";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { maskContacts } from "@/lib/chat-rules";
import { appealMark } from "@/lib/standards";

/** The helper explains a mark to Ops (once per mark). */
export async function appealMarkAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("error.forbidden") };
  const id = String(form.get("markId") ?? "");
  const note = String(form.get("note") ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: t("error.changed") };
  if (note.length < 10) return { error: t("standards.appealShort") };
  if (!(await appealMark(id, viewer.profile.id, maskContacts(note).text))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}
