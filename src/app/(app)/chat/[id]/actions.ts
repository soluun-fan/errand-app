"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { accessFor, chatImageExists, createChatImageSlot, storeMessage } from "@/lib/chat";
import { loadDeal } from "@/lib/db/deals";
import type { ErrandDeal } from "@/lib/engine";
import { notify } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

async function senderContext(dealId: string) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) return null;
  const deal = await loadDeal(createAdminClient(), dealId);
  if (!deal || deal.type !== "errand") return null;
  const access = await accessFor(deal, viewer.profile.id);
  if (!access.canSend || !access.threadHelperId || !access.counterpartId) return null;
  return { viewer, deal: deal as ErrandDeal, access };
}

/** Upload slot for one chat photo (JPEG, ≤ 10 MB) — only for someone who may send in this chat. */
export async function prepareChatImage(dealId: string, bytes: number): Promise<{ path: string; token: string } | { error: string }> {
  const t = await getT();
  const ctx = await senderContext(dealId);
  if (!ctx) return { error: t("chat.closed") };
  if (!(bytes > 0 && bytes <= MAX_CHAT_IMAGE_BYTES)) return { error: t("proof.tooBig") };
  return createChatImageSlot(dealId);
}

/**
 * Sends one message. Access is re-checked here (the database also refuses client writes);
 * contact details are masked and the sender is told; the other side gets a push without content.
 */
export async function sendChat(dealId: string, text: string, imagePath: string | null): Promise<{ error?: string; masked?: boolean }> {
  const t = await getT();
  const ctx = await senderContext(dealId);
  if (!ctx) return { error: t("chat.closed") };
  if (imagePath && !(await chatImageExists(dealId, imagePath))) return { error: t("proof.failed") };
  const r = await storeMessage({
    dealId,
    helperId: ctx.access.threadHelperId as string,
    fromUserId: ctx.viewer.profile.id,
    text: String(text ?? "").slice(0, 2000),
    imagePath,
  });
  if (!r.ok) return { error: t(r.reason === "rate" ? "chat.slowDown" : r.reason === "closed" ? "chat.closed" : "chat.empty") };
  const toCustomer = ctx.access.counterpartId === ctx.deal.customerId;
  await notify([ctx.access.counterpartId as string], {
    title: "push.chatTitle",
    body: "push.chatBody",
    params: { name: ctx.viewer.profile.name || "—" },
    url: `/chat/${dealId}`,
    tag: `chat-${dealId}${toCustomer ? "" : "-h"}`,
  });
  refresh();
  return { masked: r.masked };
}
