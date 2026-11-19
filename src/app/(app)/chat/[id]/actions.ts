"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { MAX_VOICE_SECONDS, type CallLog } from "@/lib/call-rules";
import { callParty, callsEnabled, iceConfig, incomingCall, logCall, sendSignal, signalsToMe, type IncomingCall, type SignalToMe } from "@/lib/calls";
import { CHAT_AUDIO_MIME, accessFor, chatImageExists, createChatImageSlot, storeMessage } from "@/lib/chat";
import { loadDeal } from "@/lib/db/deals";
import type { ErrandDeal } from "@/lib/engine";
import { notify } from "@/lib/push";
import { CallEndKind, CallLogInput, UploadPath, Uuid, isValid, parseOr } from "@/lib/input";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

/** `withHelper`: which applicant's conversation the customer means (while choosing); ignored for helpers. */
const helperParam = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : parseOr(Uuid, v));

async function senderContext(dealId: string, withHelper: string | null) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!parseOr(Uuid, dealId)) return null;
  const deal = await loadDeal(createAdminClient(), dealId);
  if (!deal || deal.type !== "errand") return null;
  const access = await accessFor(deal, viewer, Date.now(), helperParam(withHelper));
  if (!access.canSend || !access.threadHelperId || !access.counterpartId) return null;
  return { viewer, deal: deal as ErrandDeal, access };
}

/** Upload slot for one chat photo (JPEG, ≤ 10 MB) — only for someone who may send in this chat. */
export async function prepareChatImage(dealId: string, bytes: number, withHelper: string | null = null): Promise<{ path: string; token: string } | { error: string }> {
  const t = await getT();
  const ctx = await senderContext(dealId, withHelper);
  if (!ctx || ctx.access.inquiry) return { error: t("chat.closed") };
  if (!(typeof bytes === "number" && bytes > 0 && bytes <= MAX_CHAT_IMAGE_BYTES)) return { error: t("proof.tooBig") };
  return createChatImageSlot(dealId);
}

/**
 * Sends one message. Access is re-checked here (the database also refuses client writes);
 * contact details are masked and the sender is told; the other side gets a push without content.
 */
export async function sendChat(dealId: string, text: string, imagePath: string | null, withHelper: string | null = null): Promise<{ error?: string; masked?: boolean }> {
  const t = await getT();
  const ctx = await senderContext(dealId, withHelper);
  if (!ctx || (ctx.access.inquiry && imagePath !== null)) return { error: t("chat.closed") };
  if (typeof text !== "string" || !isValid(UploadPath.nullable(), imagePath)) return { error: t("chat.empty") };
  if (imagePath && !(await chatImageExists(dealId, imagePath))) return { error: t("proof.failed") };
  const r = await storeMessage({
    dealId,
    helperId: ctx.access.threadHelperId as string,
    fromUserId: ctx.viewer.profile.id,
    text: String(text ?? "").slice(0, 2000),
    imagePath,
    inquiry: ctx.access.inquiry,
  });
  if (!r.ok) return { error: t(r.reason === "rate" ? "chat.slowDown" : r.reason === "closed" ? "chat.closed" : "chat.empty") };
  const toCustomer = ctx.access.counterpartId === ctx.deal.customerId;
  await notify([ctx.access.counterpartId as string], {
    title: "push.chatTitle",
    body: "push.chatBody",
    params: { name: ctx.viewer.profile.name || "—" },
    // the customer's link names the applicant (one conversation per applicant while choosing)
    url: toCustomer ? `/chat/${dealId}?with=${ctx.access.threadHelperId}` : `/chat/${dealId}`,
    tag: `chat-${dealId}${toCustomer ? `-${ctx.access.threadHelperId}` : "-h"}`,
  });
  refresh();
  return { masked: r.masked };
}

/* ---------- voice messages (also the fallback when a call can't connect) ---------- */

export async function prepareVoice(dealId: string, mime: string, bytes: number, withHelper: string | null = null): Promise<{ path: string; token: string } | { error: string }> {
  const t = await getT();
  const ctx = await senderContext(dealId, withHelper);
  if (!ctx || ctx.access.inquiry) return { error: t("chat.closed") };
  if (typeof mime !== "string" || typeof bytes !== "number") return { error: t("call.unsupported") };
  const base = mime.split(";")[0];
  if (!CHAT_AUDIO_MIME.includes(base)) return { error: t("call.unsupported") };
  if (!(bytes > 0 && bytes <= MAX_CHAT_IMAGE_BYTES)) return { error: t("proof.tooBig") };
  return createChatImageSlot(dealId, base);
}

export async function sendVoice(dealId: string, path: string, seconds: number, withHelper: string | null = null): Promise<{ error?: string }> {
  const t = await getT();
  const ctx = await senderContext(dealId, withHelper);
  if (!ctx || ctx.access.inquiry) return { error: t("chat.closed") };
  if (!parseOr(UploadPath, path) || !(await chatImageExists(dealId, path))) return { error: t("proof.failed") };
  const secs = Math.min(MAX_VOICE_SECONDS, Math.max(1, Math.round(Number(seconds) || 1)));
  const r = await storeMessage({ dealId, helperId: ctx.access.threadHelperId as string, fromUserId: ctx.viewer.profile.id, text: "", audioPath: path, audioSeconds: secs });
  if (!r.ok) return { error: t(r.reason === "rate" ? "chat.slowDown" : "chat.empty") };
  await notify([ctx.access.counterpartId as string], {
    title: "push.chatTitle",
    body: "push.chatBody",
    params: { name: ctx.viewer.profile.name || "—" },
    url: ctx.access.counterpartId === ctx.deal.customerId ? `/chat/${dealId}?with=${ctx.access.threadHelperId}` : `/chat/${dealId}`,
    tag: `chat-${dealId}`,
  });
  refresh();
  return {};
}

/* ---------- calls: the browser does WebRTC; these relay the handshake after checking access ---------- */

async function callContext(dealId: string, withHelper: string | null) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!parseOr(Uuid, dealId)) return null;
  const deal = await loadDeal(createAdminClient(), dealId);
  if (!deal || deal.type !== "errand") return null;
  const party = callParty(deal, viewer.profile.id, helperParam(withHelper));
  return party ? { viewer, deal, party } : null;
}

const uuid = (v: unknown) => parseOr(Uuid, v) !== null;
const sdpOk = (v: unknown) => typeof v === "string" && v.length <= 20_000;

/** ICE servers for this call (STUN; our own relay, relay-only, once configured). */
export async function callSetup(dealId: string, withHelper: string | null = null): Promise<{ iceServers: RTCIceServer[]; relayOnly: boolean } | { error: string }> {
  const t = await getT();
  const ctx = await callContext(dealId, withHelper);
  if (!ctx) return { error: t("call.notAllowed") };
  if (!callsEnabled()) return { error: t("call.temporarilyUnavailable") };
  const config = await iceConfig(ctx.viewer.profile.id);
  return config.relayOnly ? config : { error: t("call.temporarilyUnavailable") };
}

export async function placeCall(dealId: string, callId: string, video: boolean, sdp: string, withHelper: string | null = null): Promise<{ error?: string }> {
  const t = await getT();
  const ctx = await callContext(dealId, withHelper);
  if (!ctx || !uuid(callId) || !sdpOk(sdp)) return { error: t("call.notAllowed") };
  if (!callsEnabled() || !(await iceConfig(ctx.viewer.profile.id)).relayOnly) return { error: t("call.temporarilyUnavailable") };
  const r = await sendSignal({ dealId, callId, from: ctx.party.me, to: ctx.party.other, kind: "offer", video: Boolean(video), sdp });
  if (!r.ok) return { error: t(r.reason === "rate" ? "chat.slowDown" : "call.failed") };
  await notify([ctx.party.other], {
    title: video ? "push.videoCallTitle" : "push.callTitle",
    body: "push.callBody",
    params: { name: ctx.viewer.profile.name || "—" },
    // the customer answering an applicant's call opens that applicant's conversation
    url: ctx.party.other === ctx.deal.customerId ? `/chat/${dealId}?call=${callId}&with=${ctx.party.helperId}` : `/chat/${dealId}?call=${callId}`,
    tag: `call-${dealId}`,
  });
  return {};
}

export async function answerCall(dealId: string, callId: string, sdp: string, withHelper: string | null = null): Promise<{ error?: string }> {
  const t = await getT();
  const ctx = await callContext(dealId, withHelper);
  if (!ctx || !uuid(callId) || !sdpOk(sdp)) return { error: t("call.notAllowed") };
  if (!callsEnabled() || !(await iceConfig(ctx.viewer.profile.id)).relayOnly) return { error: t("call.temporarilyUnavailable") };
  const r = await sendSignal({ dealId, callId, from: ctx.party.me, to: ctx.party.other, kind: "answer", video: false, sdp });
  return r.ok ? {} : { error: t("call.failed") };
}

/**
 * Ends / declines / reports busy, and writes the call-log line into the chat (once per call).
 * Allowed even if the task just changed status, so a call can always be hung up cleanly.
 */
export async function endCall(dealId: string, callId: string, rawKind: "hangup" | "decline" | "busy", rawLog: CallLog | null, withHelper: string | null = null): Promise<void> {
  const viewer = await getViewer();
  const kind = parseOr(CallEndKind, rawKind);
  const log = rawLog === null ? null : parseOr(CallLogInput, rawLog);
  if (!viewer || !uuid(dealId) || !uuid(callId) || !kind || (rawLog !== null && !log)) return;
  const deal = await loadDeal(createAdminClient(), dealId);
  if (!deal || deal.type !== "errand") return;
  const me = viewer.profile.id;
  // Who the call was with: an applicant while choosing, else the chosen helper. Allowed even if the
  // task changed status meanwhile, so a call can always be hung up — but only by someone on this task.
  const asked = helperParam(withHelper);
  const helperId = me === deal.customerId ? (asked ?? deal.helperId) : me;
  if (!helperId) return;
  const onTask = me === deal.customerId || me === deal.helperId || deal.offers.some((o) => o.helperId === me);
  if (!onTask || (me === deal.customerId && helperId !== deal.helperId && !deal.offers.some((o) => o.helperId === helperId))) return;
  const other = me === deal.customerId ? helperId : deal.customerId;
  await sendSignal({ dealId, callId, from: me, to: other, kind, video: false, sdp: null });
  // the log line goes into the conversation with that helper (care work: proof that you talked)
  if (log) await logCall({ dealId, helperId, fromUserId: me, callId, log });
}

/** The ringing offer behind a "?call=" link (from the push), if it's still ringing. */
export async function getIncoming(dealId: string, callId: string, withHelper: string | null = null): Promise<IncomingCall | null> {
  if (!callsEnabled()) return null;
  const ctx = await callContext(dealId, withHelper);
  if (!ctx || !uuid(callId)) return null;
  return incomingCall(dealId, callId, ctx.party.me);
}

/** What the other side has sent for this call (answer / decline / hangup / busy). */
export async function callStatus(dealId: string, callId: string): Promise<SignalToMe[]> {
  if (!callsEnabled()) return [];
  const viewer = await getViewer();
  if (!viewer || !uuid(dealId) || !uuid(callId)) return [];
  return signalsToMe(dealId, callId, viewer.profile.id);
}
