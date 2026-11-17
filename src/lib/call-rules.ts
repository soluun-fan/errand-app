/**
 * Call rules (docs/decisions.md 2026-11-14) — pure, shared by server and browser.
 * Calls are only for a live task between its customer and chosen helper; no recording.
 */
import type { DealStatus } from "@/lib/engine";

/** Statuses during which the two sides may call (not after it ends, not during a dispute). */
export const CALL_STATUSES: readonly DealStatus[] = ["open", "awaiting_payment", "matched", "in_progress", "check"];

/** Care work (children, patients): the customer must have talked to a helper this long before choosing them. */
export const CARE_CALL_MIN_SECONDS = 30;

/** Whether a conversation's call log shows a real call (answered, at least `min` seconds). */
export function hadRealCall(logTexts: readonly string[], min = CARE_CALL_MIN_SECONDS): boolean {
  return logTexts.some((text) => {
    const c = decodeCallLog(text);
    return c !== null && c.kind === "ended" && c.seconds >= min;
  });
}
/** An unanswered call stops ringing after this long and is logged as missed. */
export const RING_TIMEOUT_MS = 45_000;
/** Signals carry network addresses — the server deletes them after this long. */
export const SIGNAL_TTL_MS = 60 * 60_000;
export const MAX_SDP_CHARS = 20_000;
/** Max new calls one person may start per task per minute. */
export const CALLS_PER_MINUTE = 4;
/** Voice messages: at most this long. */
export const MAX_VOICE_SECONDS = 120;

export type SignalKind = "offer" | "answer" | "decline" | "hangup" | "busy";
export const SIGNAL_KINDS: readonly SignalKind[] = ["offer", "answer", "decline", "hangup", "busy"];

export function callAllowed(status: DealStatus): boolean {
  return CALL_STATUSES.includes(status);
}

/** A session description we're willing to relay: an SDP blob of sane size. */
export function validSdp(sdp: unknown): sdp is string {
  return typeof sdp === "string" && sdp.length > 0 && sdp.length <= MAX_SDP_CHARS && sdp.startsWith("v=0");
}

/** Call log lines are stored as codes and rendered in the reader's language. */
export type CallLog = { kind: "missed" | "declined" | "failed"; video: boolean } | { kind: "ended"; video: boolean; seconds: number };

export function encodeCallLog(c: CallLog): string {
  return c.kind === "ended" ? `call:ended:${c.video ? "video" : "voice"}:${Math.max(0, Math.round(c.seconds))}` : `call:${c.kind}:${c.video ? "video" : "voice"}`;
}

export function decodeCallLog(text: string): CallLog | null {
  const m = /^call:(missed|declined|failed|ended):(video|voice)(?::(\d+))?$/.exec(text);
  if (!m) return null;
  const video = m[2] === "video";
  if (m[1] === "ended") return { kind: "ended", video, seconds: Number(m[3] ?? 0) };
  return { kind: m[1] as "missed" | "declined" | "failed", video };
}
