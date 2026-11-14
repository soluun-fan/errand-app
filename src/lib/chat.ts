import "server-only";
import { CHAT_RATE_PER_MINUTE, CHAT_RETENTION_DAYS, chatAccess, cleanMessage, maskContacts, type ChatAccess } from "@/lib/chat-rules";
import type { ErrandDeal } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * In-task chat (docs/decisions.md 2026-11-14). Reads and writes use the service role, always after
 * `accessFor()` — the same rule the database's RLS enforces for direct (Realtime) reads.
 */
export const CHAT_BUCKET = "chat";

export interface ChatMessage {
  id: string;
  fromMe: boolean;
  text: string;
  imageUrl: string | null;
  masked: boolean;
  seen: boolean;
  at: number;
}

async function endedAt(dealId: string): Promise<number | null> {
  const { data } = await createAdminClient().from("deals").select("updated_at").eq("id", dealId).maybeSingle<{ updated_at: string }>();
  return data ? Date.parse(data.updated_at) : null;
}

/** What this viewer may do in this task's chat (and which conversation is theirs). */
export async function accessFor(deal: ErrandDeal, viewerId: string, now = Date.now()): Promise<ChatAccess> {
  const ended = ["released", "refunded", "cancelled", "expired"].includes(deal.status) ? await endedAt(deal.id) : null;
  let hadThread = false;
  if (viewerId !== deal.customerId && viewerId !== deal.helperId) {
    const { count } = await createAdminClient()
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", deal.id)
      .eq("helper_id", viewerId);
    hadThread = Boolean(count);
  }
  return chatAccess({ status: deal.status, customerId: deal.customerId, helperId: deal.helperId, endedAt: ended }, viewerId, now, hadThread);
}

/** The viewer's conversation, oldest first, with 1-hour signed photo URLs. */
export async function loadThread(dealId: string, helperId: string, viewerId: string): Promise<ChatMessage[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("messages")
    .select("id, from_user_id, text, image_path, flags, seen_at, created_at")
    .eq("deal_id", dealId)
    .eq("helper_id", helperId)
    .order("created_at")
    .limit(500)
    .returns<{ id: string; from_user_id: string | null; text: string; image_path: string | null; flags: string[]; seen_at: string | null; created_at: string }[]>();
  const rows = data ?? [];
  const paths = rows.map((r) => r.image_path).filter((p): p is string => Boolean(p));
  const signed = paths.length ? ((await db.storage.from(CHAT_BUCKET).createSignedUrls(paths, 3600)).data ?? []) : [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    fromMe: r.from_user_id === viewerId,
    text: r.text,
    imageUrl: r.image_path ? (urlOf.get(r.image_path) ?? null) : null,
    masked: (r.flags ?? []).includes("contact_masked"),
    seen: r.seen_at !== null,
    at: Date.parse(r.created_at),
  }));
}

/** Messages the viewer hasn't seen yet in their conversation (for badges). */
export async function unreadCount(dealId: string, helperId: string, viewerId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("helper_id", helperId)
    .neq("from_user_id", viewerId)
    .is("seen_at", null);
  return count ?? 0;
}

export async function markSeen(dealId: string, helperId: string, viewerId: string): Promise<void> {
  await createAdminClient()
    .from("messages")
    .update({ seen_at: new Date().toISOString() })
    .eq("deal_id", dealId)
    .eq("helper_id", helperId)
    .neq("from_user_id", viewerId)
    .is("seen_at", null);
}

export type SendResult = { ok: true; masked: boolean } | { ok: false; reason: "empty" | "rate" | "closed" };

/**
 * Stores one message after the caller checked `accessFor().canSend`. Masks contact details, applies
 * the per-minute rate limit, and flags masked messages for Ops (repeat offenders show up there).
 */
export async function storeMessage(p: { dealId: string; helperId: string; fromUserId: string; text: string; imagePath?: string | null }): Promise<SendResult> {
  const db = createAdminClient();
  const body = p.text.trim() ? cleanMessage(p.text) : "";
  if (body === null || (!body && !p.imagePath)) return { ok: false, reason: "empty" };
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", p.dealId)
    .eq("from_user_id", p.fromUserId)
    .gt("created_at", since);
  if ((count ?? 0) >= CHAT_RATE_PER_MINUTE) return { ok: false, reason: "rate" };
  const { text, masked } = maskContacts(body);
  await db
    .from("messages")
    .insert({
      deal_id: p.dealId,
      helper_id: p.helperId,
      from_user_id: p.fromUserId,
      text,
      image_path: p.imagePath ?? null,
      flags: masked ? ["contact_masked"] : [],
    })
    .throwOnError();
  return { ok: true, masked };
}

export async function createChatImageSlot(dealId: string): Promise<{ path: string; token: string }> {
  const path = `${dealId}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await createAdminClient().storage.from(CHAT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
  return { path, token: data.token };
}

/** The upload really landed in this task's folder. */
export async function chatImageExists(dealId: string, path: string): Promise<boolean> {
  if (!path.startsWith(`${dealId}/`) || path.includes("..")) return false;
  const name = path.slice(dealId.length + 1);
  const { data } = await createAdminClient().storage.from(CHAT_BUCKET).list(dealId, { search: name, limit: 1 });
  return Boolean(data?.some((f) => f.name === name));
}

/**
 * Retention: delete chats (and their photos) of tasks that ended more than 90 days ago.
 * Disputed tasks aren't "ended", so their chats stay until Ops resolves them. Run from the cron tick.
 */
export async function purgeExpiredChats(now = Date.now()): Promise<number> {
  const db = createAdminClient();
  const cutoff = new Date(now - CHAT_RETENTION_DAYS * 24 * 3_600_000).toISOString();
  const { data: deals } = await db
    .from("deals")
    .select("id")
    .in("status", ["released", "refunded", "cancelled", "expired"])
    .lt("updated_at", cutoff)
    .limit(200);
  let removed = 0;
  for (const { id } of (deals ?? []) as { id: string }[]) {
    const { data: msgs } = await db.from("messages").select("id, image_path").eq("deal_id", id);
    if (!msgs?.length) continue;
    const paths = msgs.map((m) => m.image_path as string | null).filter((x): x is string => Boolean(x));
    if (paths.length) await db.storage.from(CHAT_BUCKET).remove(paths);
    await db.from("messages").delete().eq("deal_id", id);
    removed += msgs.length;
  }
  return removed;
}
