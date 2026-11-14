import "server-only";
import { CALLS_PER_MINUTE, RING_TIMEOUT_MS, SIGNAL_TTL_MS, callAllowed, encodeCallLog, validSdp, type CallLog, type SignalKind } from "@/lib/call-rules";
import type { ErrandDeal } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { turnCredentials } from "@/lib/turn";

/**
 * In-task calls (docs/decisions.md 2026-11-14). The browser does WebRTC; this module only relays
 * the handshake through `call_signals` (RLS: the two people on the call) after checking access,
 * hands out ICE servers, writes call-log lines into the chat and deletes old signals.
 */

export interface CallParty {
  me: string;
  other: string;
  helperId: string;
}

/** Who may call whom on this task right now (customer ⇄ chosen helper, live task only). */
export function callParty(deal: ErrandDeal, viewerId: string): CallParty | null {
  if (!deal.helperId || !callAllowed(deal.status)) return null;
  if (viewerId === deal.customerId) return { me: viewerId, other: deal.helperId, helperId: deal.helperId };
  if (viewerId === deal.helperId) return { me: viewerId, other: deal.customerId, helperId: deal.helperId };
  return null;
}

/**
 * ICE servers for a call. Public STUN always (no key); our own TURN relay when TURN_URLS +
 * TURN_SECRET are set — then calls are relay-only, so neither side ever sees the other's address.
 */
export function iceConfig(userId: string, now = Date.now()): { iceServers: RTCIceServer[]; relayOnly: boolean } {
  const iceServers: RTCIceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  const urls = (process.env.TURN_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const secret = process.env.TURN_SECRET;
  if (urls.length && secret) {
    iceServers.push({ urls, ...turnCredentials(secret, userId, now) });
    return { iceServers, relayOnly: true };
  }
  return { iceServers, relayOnly: false };
}

export type SignalResult = { ok: true } | { ok: false; reason: "rate" | "invalid" };

export async function sendSignal(p: {
  dealId: string;
  callId: string;
  from: string;
  to: string;
  kind: SignalKind;
  video: boolean;
  sdp: string | null;
}): Promise<SignalResult> {
  const needsSdp = p.kind === "offer" || p.kind === "answer";
  if (needsSdp !== validSdp(p.sdp)) return { ok: false, reason: "invalid" };
  const db = createAdminClient();
  if (p.kind === "offer") {
    const { count } = await db
      .from("call_signals")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", p.dealId)
      .eq("from_user_id", p.from)
      .eq("kind", "offer")
      .gt("created_at", new Date(Date.now() - 60_000).toISOString());
    if ((count ?? 0) >= CALLS_PER_MINUTE) return { ok: false, reason: "rate" };
  }
  await db
    .from("call_signals")
    .insert({ deal_id: p.dealId, call_id: p.callId, from_user_id: p.from, to_user_id: p.to, kind: p.kind, video: p.video, sdp: needsSdp ? p.sdp : null })
    .throwOnError();
  return { ok: true };
}

export interface IncomingCall {
  callId: string;
  fromUserId: string;
  video: boolean;
  sdp: string;
  at: number;
}

/** A still-ringing offer to `viewerId` (fresh, and not already answered, declined or hung up). */
export async function incomingCall(dealId: string, callId: string, viewerId: string, now = Date.now()): Promise<IncomingCall | null> {
  const { data } = await createAdminClient()
    .from("call_signals")
    .select("kind, from_user_id, to_user_id, video, sdp, created_at")
    .eq("deal_id", dealId)
    .eq("call_id", callId)
    .order("created_at")
    .returns<{ kind: SignalKind; from_user_id: string; to_user_id: string; video: boolean; sdp: string | null; created_at: string }[]>();
  const rows = data ?? [];
  const offer = rows.find((r) => r.kind === "offer" && r.to_user_id === viewerId);
  if (!offer || !offer.sdp) return null;
  const at = Date.parse(offer.created_at);
  if (now - at > RING_TIMEOUT_MS || rows.some((r) => r.kind !== "offer")) return null;
  return { callId, fromUserId: offer.from_user_id, video: offer.video, sdp: offer.sdp, at };
}

/** Adds a call-log line to the chat once per call (the first side to report wins). */
export async function logCall(p: { dealId: string; helperId: string; fromUserId: string; callId: string; log: CallLog }): Promise<void> {
  const db = createAdminClient();
  const tag = `call:${p.callId}`;
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("deal_id", p.dealId).contains("flags", [tag]);
  if (count) return;
  await db
    .from("messages")
    .insert({ deal_id: p.dealId, helper_id: p.helperId, from_user_id: p.fromUserId, is_system: true, text: encodeCallLog(p.log), flags: [tag] })
    .throwOnError();
}

/** Signals contain network addresses: delete them after an hour. Run from the cron tick. */
export async function purgeOldSignals(now = Date.now()): Promise<void> {
  await createAdminClient().from("call_signals").delete().lt("created_at", new Date(now - SIGNAL_TTL_MS).toISOString());
}

export interface SignalToMe {
  kind: SignalKind;
  sdp: string | null;
  at: number;
}

/** Signals addressed to `viewerId` for one call (the 2 s poll that backs up Realtime). */
export async function signalsToMe(dealId: string, callId: string, viewerId: string): Promise<SignalToMe[]> {
  const { data } = await createAdminClient()
    .from("call_signals")
    .select("kind, sdp, created_at")
    .eq("deal_id", dealId)
    .eq("call_id", callId)
    .eq("to_user_id", viewerId)
    .order("created_at")
    .returns<{ kind: SignalKind; sdp: string | null; created_at: string }[]>();
  return (data ?? []).map((r) => ({ kind: r.kind, sdp: r.sdp, at: Date.parse(r.created_at) }));
}
