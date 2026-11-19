import "server-only";
import { CALLS_PER_MINUTE, RING_TIMEOUT_MS, SIGNAL_TTL_MS, callAllowed, encodeCallLog, validSdp, type CallLog, type SignalKind } from "@/lib/call-rules";
import { liveOffers, type ErrandDeal } from "@/lib/engine";
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

export const callsEnabled = () => process.env.CALLS_ENABLED === "true";

/**
 * Who may call whom on this task right now: while choosing, the customer ⇄ one applicant
 * (`withHelper` says which, for the customer); after that, customer ⇄ chosen helper.
 */
export function callParty(deal: ErrandDeal, viewerId: string, withHelper: string | null = null, now = Date.now()): CallParty | null {
  if (!callAllowed(deal.status)) return null;
  if (deal.status === "open") {
    const applicants = liveOffers(deal, now).map((o) => o.helperId);
    if (applicants.includes(viewerId)) return { me: viewerId, other: deal.customerId, helperId: viewerId };
    if (viewerId === deal.customerId && withHelper && applicants.includes(withHelper)) return { me: viewerId, other: withHelper, helperId: withHelper };
    return null;
  }
  if (!deal.helperId) return null;
  if (viewerId === deal.customerId) return { me: viewerId, other: deal.helperId, helperId: deal.helperId };
  if (viewerId === deal.helperId) return { me: viewerId, other: deal.customerId, helperId: deal.helperId };
  return null;
}

/** Cloudflare TURN credentials, shared for a while (they aren't tied to a person; the call is). */
let cfCache: { at: number; servers: RTCIceServer[] } | null = null;
const CF_TTL_S = 4 * 3600;

/**
 * Cloudflare's managed TURN relay (docs/deploy.md "Calls"): CLOUDFLARE_TURN_KEY_ID +
 * CLOUDFLARE_TURN_API_TOKEN. Short-lived credentials, refreshed every ~2 h; port-53 URLs are dropped
 * (browsers block them and they'd only slow the call down). Null if not set up or Cloudflare fails.
 */
async function cloudflareIce(now: number): Promise<RTCIceServer[] | null> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return null;
  if (cfCache && now - cfCache.at < (CF_TTL_S / 2) * 1000) return cfCache.servers;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: CF_TTL_S }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Cloudflare TURN ${res.status}`);
    const body = (await res.json()) as { iceServers?: RTCIceServer[] | RTCIceServer };
    const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    const servers = list
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length > 0);
    if (!servers.some((s) => s.urls.some((u) => u.startsWith("turn")))) throw new Error("Cloudflare TURN: no relay in the answer");
    cfCache = { at: now, servers };
    return servers;
  } catch (e) {
    console.error("cloudflare turn failed", e);
    return null;
  }
}

/**
 * ICE servers for a call. Calls require TURN; never fall back to direct connections when it is absent.
 */
export async function iceConfig(userId: string, now = Date.now()): Promise<{ iceServers: RTCIceServer[]; relayOnly: boolean }> {
  const cf = await cloudflareIce(now);
  if (cf) return { iceServers: cf, relayOnly: true };
  const urls = (process.env.TURN_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const secret = process.env.TURN_SECRET;
  if (urls.length && secret) {
    return { iceServers: [{ urls, ...turnCredentials(secret, userId, now) }], relayOnly: true };
  }
  return { iceServers: [], relayOnly: false };
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
export async function logCall(p: { dealId: string; helperId: string; fromUserId: string; callId: string; log: CallLog }, now = Date.now()): Promise<void> {
  const db = createAdminClient();
  const tag = `call:${p.callId}`;
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("deal_id", p.dealId).contains("flags", [tag]);
  if (count) return;
  // The browser reports the length; the server only believes what it relayed: an "ended" call must
  // have an answer on record, and can't have lasted longer than the time since that answer.
  // (Care work needs a real call before choosing, so this line is evidence.)
  if (p.log.kind === "ended") {
    const { data: answer } = await db
      .from("call_signals")
      .select("created_at")
      .eq("deal_id", p.dealId)
      .eq("call_id", p.callId)
      .eq("kind", "answer")
      .order("created_at")
      .limit(1)
      .maybeSingle<{ created_at: string }>();
    p.log = answer
      ? { ...p.log, seconds: Math.max(0, Math.min(p.log.seconds, Math.floor((now - Date.parse(answer.created_at)) / 1000))) }
      : { kind: "failed", video: p.log.video };
  }
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
