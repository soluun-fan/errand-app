/**
 * Chat rules (docs/decisions.md 2026-11-14) — pure, unit-tested.
 * - A conversation is one (task, helper) pair: a helper released before payment keeps read access
 *   to *their* messages, and the next helper never sees them.
 * - Open from "helper chosen" (awaiting_payment) through check/dispute; read-only 24 h after the
 *   task ends. Open jobs support private enquiries before application.
 * - Contact details are masked: phone numbers, e-mails and links (off-app deals lose the held-money
 *   protection, and phone numbers are never shown — CLAUDE.md non-negotiables).
 */
import type { DealStatus } from "@/lib/engine";

export const CHAT_MAX_CHARS = 1000;
/** Max messages one person may send in one conversation per minute. */
export const CHAT_RATE_PER_MINUTE = 20;
/** After the task ends, sending stays possible this long (then read-only). */
export const CHAT_GRACE_MS = 24 * 3_600_000;
/** Chats (and their photos) are deleted this long after the task ends, unless it's disputed. */
export const CHAT_RETENTION_DAYS = 90;

const LIVE: DealStatus[] = ["awaiting_payment", "matched", "in_progress", "check", "disputed"];
const ENDED: DealStatus[] = ["released", "refunded", "cancelled", "expired"];

export interface ChatDealView {
  status: DealStatus;
  customerId: string;
  /** The currently assigned helper (null once released back to "open"). */
  helperId: string | null;
  /** When the task reached its final status (deals.updated_at), for the 24 h grace. */
  endedAt: number | null;
  /** Helpers with a live application while the task is open (they may talk to the customer before being chosen). */
  applicants?: readonly string[];
  /** Server-resolved candidate for a private pre-application question on this open job. */
  inquiryHelper?: string | null;
}

export interface ChatAccess {
  inquiry?: boolean;
  canRead: boolean;
  canSend: boolean;
  /** The helper whose conversation this viewer sees (the thread key), or null. */
  threadHelperId: string | null;
  /** Who the viewer is talking to. */
  counterpartId: string | null;
}

const NONE: ChatAccess = { canRead: false, canSend: false, threadHelperId: null, counterpartId: null };

/**
 * What `viewerId` may do in the chat of this task. `hadThread` says whether a released helper
 * already has messages here (they keep read-only access to their own conversation).
 */
export function chatAccess(deal: ChatDealView, viewerId: string, now: number, hadThread = false, withHelper: string | null = null): ChatAccess {
  const isCustomer = viewerId === deal.customerId;
  // Before choosing (docs/decisions.md 2026-11-17 "Talk before choosing"): the customer and each
  // applicant have their own conversation; the customer picks which one with `withHelper`.
  if (deal.status === "open") {
    const applicants = deal.applicants ?? [];
    if (applicants.includes(viewerId)) return { canRead: true, canSend: true, threadHelperId: viewerId, counterpartId: deal.customerId };
    if (isCustomer && withHelper && applicants.includes(withHelper)) return { canRead: true, canSend: true, threadHelperId: withHelper, counterpartId: withHelper };
    const helper = deal.inquiryHelper;
    if (helper && helper !== deal.customerId && (viewerId === helper || (isCustomer && withHelper === helper && hadThread))) {
      return { canRead: true, canSend: true, inquiry: true, threadHelperId: helper, counterpartId: isCustomer ? helper : deal.customerId };
    }
  }
  // Once someone is chosen, the customer can still read (not write) a conversation with another applicant.
  if (isCustomer && withHelper && withHelper !== deal.helperId && hadThread) {
    return { canRead: true, canSend: false, threadHelperId: withHelper, counterpartId: withHelper };
  }
  const isHelper = deal.helperId !== null && viewerId === deal.helperId;
  const ended = ENDED.includes(deal.status);
  const inGrace = ended && deal.endedAt !== null && now < deal.endedAt + CHAT_GRACE_MS;

  if (isCustomer || isHelper) {
    if (deal.helperId === null) return NONE; // nobody chosen (yet / any more)
    const live = LIVE.includes(deal.status);
    return {
      canRead: live || ended,
      canSend: live || inGrace,
      threadHelperId: deal.helperId,
      counterpartId: isCustomer ? deal.helperId : deal.customerId,
    };
  }
  // A helper who was chosen earlier but released: read-only access to their own conversation.
  if (hadThread) return { canRead: true, canSend: false, threadHelperId: viewerId, counterpartId: deal.customerId };
  return NONE;
}

/* ---------- contact masking ---------- */

const MASK = "•••• ••••";
// Candidate digit runs (spaces / dashes / dots / brackets allowed between digits); `looksLikePhone` decides.
const DIGITS = /\+?(?:\d[\s().-]*){6,}\d/g;

/**
 * Mongolian numbers: 8 digits starting 5–9 (mobile), with or without +976 / 976; anything with a
 * leading "+" or 9+ digits is treated as a phone too. Prices ("1 250 000₮") and dates
 * ("2026-11-14") are not.
 */
function looksLikePhone(match: string, after: string): boolean {
  if (/^\s*(₮|төг|tug|mnt)/i.test(after)) return false;
  let d = match.replace(/\D/g, "");
  const plus = match.trimStart().startsWith("+");
  if (d.startsWith("976") && d.length >= 11) d = d.slice(3);
  if (plus || d.length >= 9) return true;
  return d.length === 8 && /^[5-9]/.test(d);
}
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|mn|net|org|io|me|link|ly|gg|app|to)(?:\/\S*)?\b/gi;
const HANDLE = /\b(?:fb|facebook|insta(?:gram)?|telegram|tg|whatsapp|viber|wechat|line|kakao)\s*[:@-]?\s*@?[\w.]{3,}/gi;

/** Masks phone numbers, e-mails, links and messenger handles. Short numbers (door codes, prices) stay. */
export function maskContacts(input: string): { text: string; masked: boolean } {
  let masked = false;
  const hit = () => {
    masked = true;
    return MASK;
  };
  const text = input
    .replace(EMAIL, hit)
    .replace(URL, hit)
    .replace(HANDLE, hit)
    .replace(DIGITS, (m, offset: number, whole: string) => (looksLikePhone(m, whole.slice(offset + m.length)) ? hit() : m));
  return { text, masked };
}

/** Normalizes and validates a message body: trimmed, ≤ 1000 chars, collapsed blank lines. */
export function cleanMessage(raw: string): string | null {
  const t = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!t || t.length > CHAT_MAX_CHARS) return null;
  return t;
}
