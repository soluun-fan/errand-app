import "server-only";
import { getRules } from "@/lib/rules";
import { CHAT_RATE_PER_MINUTE, CHAT_RETENTION_DAYS, chatAccess, cleanMessage, maskContacts, type ChatAccess } from "@/lib/chat-rules";
import { hadRealCall } from "@/lib/call-rules";
import type { Viewer } from "@/lib/auth";
import { categoryTrust, invitedOnly, liveOffers, type ErrandDeal } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * In-task chat (docs/decisions.md 2026-11-14). Reads and writes use the service role, always after
 * `accessFor()` — the same rule the database's RLS enforces for direct (Realtime) reads.
 */
export const CHAT_BUCKET = "chat";

export interface ChatMessage {
  id: string;
  fromMe: boolean;
  /** Call-log line (`call:…` code, rendered in the reader's language). */
  system: boolean;
  text: string;
  imageUrl: string | null;
  audioUrl: string | null;
  audioSeconds: number | null;
  masked: boolean;
  seen: boolean;
  at: number;
}

async function endedAt(dealId: string): Promise<number | null> {
  const { data } = await createAdminClient().from("deals").select("updated_at").eq("id", dealId).maybeSingle<{ updated_at: string }>();
  return data ? Date.parse(data.updated_at) : null;
}

/** What this viewer may do in this task's chat (and which conversation is theirs). */
export async function accessFor(deal: ErrandDeal, viewer: Viewer, now = Date.now(), withHelper: string | null = null): Promise<ChatAccess> {
  const viewerId = viewer.profile.id;
  const ended = ["released", "refunded", "cancelled", "expired"].includes(deal.status) ? await endedAt(deal.id) : null;
  // whose old conversation might be readable: the viewer's own (a released helper) or the one the customer asked for
  const threadOwner = viewerId === deal.customerId ? withHelper : viewerId !== deal.helperId ? viewerId : null;
  let hadThread = false;
  if (threadOwner) {
    const { count, error } = await createAdminClient()
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", deal.id)
      .eq("helper_id", threadOwner);
    if (error) throw new Error(error.message);
    hadThread = Boolean(count);
  }
  const applicants = deal.status === "open" ? liveOffers(deal, now).map((o) => o.helperId) : [];
  let inquiryHelper: string | null = null;
  const openForQuestions =
    deal.status === "open" && categoryTrust(deal.category) !== "care" && (deal.matchBy === null || now < deal.matchBy);
  if (openForQuestions && threadOwner && !deal.offers.some((o) => o.helperId === threadOwner)) {
    const invited = invitedOnly(deal, now);
    if (invited === null || invited === threadOwner) {
      // An approved helper can initiate their own thread. An owner can reply only after a helper asked.
      if (viewerId !== deal.customerId && viewer.actor.helperApproved && !hadThread) {
        inquiryHelper = viewerId;
      } else if (hadThread && (viewerId === deal.customerId || viewer.actor.helperApproved)) {
        const { data } = await createAdminClient()
          .from("messages")
          .select("id")
          .eq("deal_id", deal.id)
          .eq("helper_id", threadOwner)
          .eq("from_user_id", threadOwner)
          .contains("flags", ["inquiry"])
          .limit(1);
        if (data?.length) inquiryHelper = threadOwner;
      }
    }
  }
  return chatAccess(
    { status: deal.status, customerId: deal.customerId, helperId: deal.helperId, endedAt: ended, applicants, inquiryHelper },
    viewerId,
    now,
    hadThread,
    withHelper,
  );
}

/** Called for the task owner. Each helper starts one private conversation per task. */
export async function questionThreads(deal: ErrandDeal, viewerId: string): Promise<Map<string, number>> {
  const threads = new Map<string, number>();
  if (viewerId !== deal.customerId || deal.status !== "open") return threads;
  const db = createAdminClient();
  // Page through messages so a busy conversation cannot hide another helper's question.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from("messages")
      .select("helper_id, from_user_id, seen_at")
      .eq("deal_id", deal.id)
      .contains("flags", ["inquiry"])
      .neq("from_user_id", viewerId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.helper_id && row.helper_id === row.from_user_id)
        threads.set(row.helper_id, (threads.get(row.helper_id) ?? 0) + (row.seen_at ? 0 : 1));
    }
    if (!data || data.length < 500) break;
  }
  return threads;
}

/** Whether the customer and this helper have had a real call on this task (care work needs one before choosing). */
export async function hadCareCall(dealId: string, helperId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("messages")
    .select("text")
    .eq("deal_id", dealId)
    .eq("helper_id", helperId)
    .eq("is_system", true)
    .like("text", "call:ended:%")
    .returns<{ text: string }[]>();
  // the required length is an Ops setting (platform_rules), the same number the database checks
  const min = (await getRules().catch(() => null))?.careCallMinSeconds;
  return hadRealCall(
    (data ?? []).map((m) => m.text),
    min,
  );
}

/** The viewer's conversation, oldest first, with 1-hour signed photo URLs. */
export async function loadThread(dealId: string, helperId: string, viewerId: string): Promise<ChatMessage[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("messages")
    .select("id, from_user_id, is_system, text, image_path, audio_path, audio_seconds, flags, seen_at, created_at")
    .eq("deal_id", dealId)
    .eq("helper_id", helperId)
    .order("created_at")
    .limit(500)
    .returns<
      {
        id: string;
        from_user_id: string | null;
        is_system: boolean;
        text: string;
        image_path: string | null;
        audio_path: string | null;
        audio_seconds: number | null;
        flags: string[];
        seen_at: string | null;
        created_at: string;
      }[]
    >();
  const rows = data ?? [];
  const paths = rows.flatMap((r) => [r.image_path, r.audio_path]).filter((p): p is string => Boolean(p));
  const signed = paths.length ? ((await db.storage.from(CHAT_BUCKET).createSignedUrls(paths, 3600)).data ?? []) : [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    fromMe: r.from_user_id === viewerId,
    system: r.is_system,
    text: r.text,
    imageUrl: r.image_path ? (urlOf.get(r.image_path) ?? null) : null,
    audioUrl: r.audio_path ? (urlOf.get(r.audio_path) ?? null) : null,
    audioSeconds: r.audio_seconds,
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
    .eq("is_system", false)
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
export async function storeMessage(p: {
  dealId: string;
  helperId: string;
  fromUserId: string;
  text: string;
  imagePath?: string | null;
  inquiry?: boolean;
  audioPath?: string | null;
  audioSeconds?: number | null;
}): Promise<SendResult> {
  const db = createAdminClient();
  const body = p.text.trim() ? cleanMessage(p.text) : "";
  if (body === null || (!body && !p.imagePath && !p.audioPath)) return { ok: false, reason: "empty" };
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
      audio_path: p.audioPath ?? null,
      audio_seconds: p.audioPath ? (p.audioSeconds ?? null) : null,
      flags: [...(masked ? ["contact_masked"] : []), ...(p.inquiry ? ["inquiry"] : [])],
    })
    .throwOnError();
  return { ok: true, masked };
}

const AUDIO_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
};
export const CHAT_AUDIO_MIME = Object.keys(AUDIO_EXT);

/** Upload slot for a chat photo (JPEG) or a voice clip (one of `CHAT_AUDIO_MIME`). */
export async function createChatImageSlot(dealId: string, mime = "image/jpeg"): Promise<{ path: string; token: string }> {
  const ext = mime === "image/jpeg" ? "jpg" : AUDIO_EXT[mime];
  if (!ext) throw new Error("Unsupported file type");
  const path = `${dealId}/${crypto.randomUUID()}.${ext}`;
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
  const days = (await getRules().catch(() => null))?.chatRetentionDays ?? CHAT_RETENTION_DAYS; // Ops setting (2026-11-22)
  const cutoff = new Date(now - days * 24 * 3_600_000).toISOString();
  const { data: deals } = await db
    .from("deals")
    .select("id")
    .in("status", ["released", "refunded", "cancelled", "expired"])
    .lt("updated_at", cutoff)
    .limit(200);
  let removed = 0;
  for (const { id } of (deals ?? []) as { id: string }[]) {
    const { data: msgs } = await db.from("messages").select("id, image_path, audio_path").eq("deal_id", id);
    if (!msgs?.length) continue;
    const paths = msgs
      .flatMap((m) => [m.image_path as string | null, m.audio_path as string | null])
      .filter((x): x is string => Boolean(x));
    if (paths.length) await db.storage.from(CHAT_BUCKET).remove(paths);
    await db.from("messages").delete().eq("deal_id", id);
    removed += msgs.length;
  }
  return removed;
}
