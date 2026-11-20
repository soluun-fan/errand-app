import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { getViewer } from "@/lib/auth";
import { normalizeMnPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingTable } from "@/lib/location-rules";

const API_URL = "https://api.verify.mn";
const POLL_INTERVAL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 8_000;

export type VerifyMnStatus = "PENDING" | "VERIFIED" | "EXPIRED";

export interface VerifyMnSession {
  sessionId: string;
  smsUri: string;
  displayInstruction: string;
  expiresAt: string;
}

export interface VerifyMnSessionStatus {
  sessionId: string;
  sessionStatus: VerifyMnStatus;
  callbackStatus: "PENDING" | "SENT" | "FAILED";
  verifiedAt: string | null;
  expiresAt: string;
}

export type RecipientVerificationStatus = "NOT_STARTED" | "CREATING" | VerifyMnStatus;

export interface RecipientVerificationView {
  status: RecipientVerificationStatus;
  inviteExpiresAt: string;
  sessionExpiresAt: string | null;
  smsUri: string | null;
  displayInstruction: string | null;
}

export interface RecipientVerificationOwnerView extends RecipientVerificationView {
  phone: string;
}

interface RecipientVerificationRow extends RecipientVerificationView {
  dealId: string;
  ownerId: string;
  shareTokenHash: string;
  phone: string;
  sessionId: string | null;
  sessionAttempts: number;
  verifiedAt: string | null;
}

export class VerifyMnError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "VerifyMnError";
  }
}

function apiKey(): string {
  const key = process.env.VERIFY_MN_API_KEY;
  if (!key) throw new Error("VERIFY_MN_API_KEY is not set — add it to .env.local or deployment secrets");
  return key;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VerifyMnError("Verify.MN returned an invalid response");
  }
  return value as Record<string, unknown>;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new VerifyMnError(`Verify.MN response is missing ${key}`);
  }
  return value;
}

function parseStatus(body: unknown): VerifyMnSessionStatus {
  const row = record(body);
  const sessionStatus = requiredString(row, "sessionStatus");
  if (sessionStatus !== "PENDING" && sessionStatus !== "VERIFIED" && sessionStatus !== "EXPIRED") {
    throw new VerifyMnError("Verify.MN returned an unknown session status");
  }
  const callbackStatus = requiredString(row, "callbackStatus");
  if (callbackStatus !== "PENDING" && callbackStatus !== "SENT" && callbackStatus !== "FAILED") {
    throw new VerifyMnError("Verify.MN returned an unknown callback status");
  }
  const verifiedAt = row.verifiedAt;
  if (verifiedAt !== undefined && verifiedAt !== null && typeof verifiedAt !== "string") {
    throw new VerifyMnError("Verify.MN returned an invalid verifiedAt");
  }
  const expiresAt = requiredString(row, "expiresAt");
  if (!Number.isFinite(Date.parse(expiresAt))) throw new VerifyMnError("Verify.MN returned an invalid expiresAt");
  return {
    sessionId: requiredString(row, "sessionId"),
    sessionStatus,
    callbackStatus,
    verifiedAt: verifiedAt ?? null,
    expiresAt,
  };
}

export function createVerifyMnClient(fetcher: typeof fetch = fetch) {
  return {
    async createSession(phone: string, text: string): Promise<VerifyMnSession> {
      const response = await fetcher(`${API_URL}/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone: normalizePhone(phone).slice(4), text }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!response.ok) throw new VerifyMnError(`Verify.MN session creation failed (${response.status})`, response.status);
      const row = record(await response.json());
      const sessionId = requiredString(row, "sessionId");
      const smsUri = requiredString(row, "smsUri");
      const displayInstruction = requiredString(row, "displayInstruction");
      const expiresAt = requiredString(row, "expiresAt");
      if (!Number.isFinite(Date.parse(expiresAt))) throw new VerifyMnError("Verify.MN returned an invalid expiresAt");
      if (!smsUri.startsWith("sms:144773?body=")) throw new VerifyMnError("Verify.MN returned an invalid smsUri");
      if (typeof row.phone !== "string" || normalizeMnPhone(row.phone) !== normalizePhone(phone)) {
        throw new VerifyMnError("Verify.MN returned a different phone number");
      }
      return { sessionId, smsUri, displayInstruction, expiresAt };
    },

    async getSession(sessionId: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<VerifyMnSessionStatus> {
      const response = await fetcher(`${API_URL}/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(Math.max(1, Math.min(REQUEST_TIMEOUT_MS, timeoutMs))),
        cache: "no-store",
      });
      if (!response.ok) throw new VerifyMnError(`Verify.MN status check failed (${response.status})`, response.status);
      const status = parseStatus(await response.json());
      if (status.sessionId !== sessionId) throw new VerifyMnError("Verify.MN returned a different session");
      return status;
    },
  };
}

const client = createVerifyMnClient();

function normalizePhone(phone: string): string {
  const normalized = normalizeMnPhone(phone);
  if (!normalized) throw new TypeError("A valid Mongolian phone number is required");
  return normalized;
}

function shareTokenHash(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TypeError("Invalid recipient verification link");
  return createHash("sha256").update(token).digest("hex");
}

function recipientRow(row: {
  deal_id: string;
  owner_id: string;
  phone: string;
  share_token_hash: string;
  status: RecipientVerificationStatus;
  session_attempts: number;
  provider_session_id: string | null;
  sms_uri: string | null;
  display_instruction: string | null;
  session_expires_at: string | null;
  verified_at: string | null;
  invite_expires_at: string;
}): RecipientVerificationRow {
  return {
    dealId: row.deal_id,
    ownerId: row.owner_id,
    phone: row.phone,
    shareTokenHash: row.share_token_hash,
    status: row.status,
    sessionAttempts: row.session_attempts,
    sessionId: row.provider_session_id,
    smsUri: row.sms_uri,
    displayInstruction: row.display_instruction,
    sessionExpiresAt: row.session_expires_at,
    verifiedAt: row.verified_at,
    inviteExpiresAt: row.invite_expires_at,
  };
}

function recipientView(row: RecipientVerificationRow): RecipientVerificationView {
  return {
    status: row.status,
    inviteExpiresAt: row.inviteExpiresAt,
    sessionExpiresAt: row.sessionExpiresAt,
    smsUri: row.smsUri,
    displayInstruction: row.displayInstruction,
  };
}

async function recipientInviteByToken(token: string): Promise<RecipientVerificationRow | null> {
  const { data, error } = await createAdminClient()
    .from("recipient_verifications")
    .select("deal_id, owner_id, phone, share_token_hash, status, session_attempts, provider_session_id, sms_uri, display_instruction, session_expires_at, verified_at, invite_expires_at")
    .eq("share_token_hash", shareTokenHash(token))
    .maybeSingle<{
      deal_id: string;
      owner_id: string;
      phone: string;
      share_token_hash: string;
      status: RecipientVerificationStatus;
      session_attempts: number;
      provider_session_id: string | null;
      sms_uri: string | null;
      display_instruction: string | null;
      session_expires_at: string | null;
      verified_at: string | null;
      invite_expires_at: string;
    }>();
  if (error) throw new Error(`Could not load recipient verification: ${error.message}`);
  return data ? recipientRow(data) : null;
}

export async function recipientVerificationFromShareLink(token: string): Promise<RecipientVerificationView | null> {
  const row = await recipientInviteByToken(token);
  return row ? recipientView(row) : null;
}

/** Create or rotate a private share link. Only the task owner may call this. */
export async function createRecipientVerificationInvite(
  dealId: string,
  ownerId: string,
  phoneInput: string,
): Promise<{ token: string | null; view: RecipientVerificationOwnerView }> {
  const phone = normalizePhone(phoneInput);
  const db = createAdminClient();
  const { data: current, error: lookupError } = await db
    .from("recipient_verifications")
    .select("deal_id, owner_id, phone, share_token_hash, status, session_attempts, provider_session_id, sms_uri, display_instruction, session_expires_at, verified_at, invite_expires_at")
    .eq("deal_id", dealId)
    .maybeSingle<{
      deal_id: string;
      owner_id: string;
      phone: string;
      share_token_hash: string;
      status: RecipientVerificationStatus;
      session_attempts: number;
      provider_session_id: string | null;
      sms_uri: string | null;
      display_instruction: string | null;
      session_expires_at: string | null;
      verified_at: string | null;
      invite_expires_at: string;
    }>();
  if (lookupError) throw new Error(`Could not load recipient verification: ${lookupError.message}`);
  const existing = current ? recipientRow(current) : null;
  if (existing?.ownerId !== undefined && existing.ownerId !== ownerId) throw new Error("Recipient verification owner mismatch");

  if (existing?.status === "VERIFIED" && existing.phone !== phone) {
    throw new Error("A different phone number has already been verified");
  }
  if (existing?.status === "VERIFIED") {
    return { token: null, view: recipientOwnerView(existing) };
  }
  const inviteStillActive = existing && Date.parse(existing.inviteExpiresAt) > Date.now();
  if (inviteStillActive && existing.phone !== phone) {
    throw new Error("An active verification link already exists for a different phone number");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  if (existing && inviteStillActive) {
    const { error } = await db
      .from("recipient_verifications")
      .update({ share_token_hash: shareTokenHash(token), session_attempts: 0, updated_at: new Date().toISOString() })
      .eq("deal_id", dealId)
      .eq("owner_id", ownerId);
    if (error) throw new Error(`Could not rotate recipient verification link: ${error.message}`);
    return { token, view: recipientOwnerView(existing) };
  }

  const values = {
    deal_id: dealId,
    owner_id: ownerId,
    phone,
    share_token_hash: shareTokenHash(token),
    status: "NOT_STARTED" as const,
    session_attempts: 0,
    provider_session_id: null,
    sms_uri: null,
    display_instruction: null,
    session_expires_at: null,
    verified_at: null,
    invite_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
  const result = existing
    ? await db.from("recipient_verifications").update(values).eq("deal_id", dealId).eq("owner_id", ownerId)
    : await db.from("recipient_verifications").insert(values);
  if (result.error) throw new Error(`Could not save recipient verification: ${result.error.message}`);
  return {
    token,
    view: {
      status: "NOT_STARTED",
      inviteExpiresAt: expiresAt,
      sessionExpiresAt: null,
      smsUri: null,
      displayInstruction: null,
      phone,
    },
  };
}

function recipientOwnerView(row: RecipientVerificationRow): RecipientVerificationOwnerView {
  return { ...recipientView(row), phone: row.phone };
}

export async function recipientVerificationForOwner(dealId: string, ownerId: string): Promise<RecipientVerificationOwnerView | null | undefined> {
  const { data, error } = await createAdminClient()
    .from("recipient_verifications")
    .select("deal_id, owner_id, phone, share_token_hash, status, session_attempts, provider_session_id, sms_uri, display_instruction, session_expires_at, verified_at, invite_expires_at")
    .eq("deal_id", dealId)
    .eq("owner_id", ownerId)
    .maybeSingle<{
      deal_id: string;
      owner_id: string;
      phone: string;
      share_token_hash: string;
      status: RecipientVerificationStatus;
      session_attempts: number;
      provider_session_id: string | null;
      sms_uri: string | null;
      display_instruction: string | null;
      session_expires_at: string | null;
      verified_at: string | null;
      invite_expires_at: string;
    }>();
  // Optional verification must not prevent customers from opening and completing their task.
  if (missingTable(error, "recipient_verifications")) return undefined;
  if (error) throw new Error(`Could not load recipient verification: ${error.message}`);
  return data ? recipientOwnerView(recipientRow(data)) : null;
}

/** Called by the recipient's private-link page after they explicitly agree to the SMS cost. */
export async function beginRecipientVerification(token: string): Promise<RecipientVerificationView | null> {
  const row = await recipientInviteByToken(token);
  if (!row) return null;
  if (Date.parse(row.inviteExpiresAt) <= Date.now()) {
    return recipientView({ ...row, status: "EXPIRED" });
  }
  if (row.status === "VERIFIED") return recipientView(row);
  if (row.status === "CREATING") return recipientView(row);
  if (row.status === "PENDING" && row.sessionId && row.sessionExpiresAt && Date.parse(row.sessionExpiresAt) > Date.now()) {
    const current = await client.getSession(row.sessionId, Date.parse(row.sessionExpiresAt) - Date.now());
    if (current.sessionStatus === "VERIFIED") {
      return saveRecipientStatus(row, current.sessionStatus, current.verifiedAt);
    }
    if (current.sessionStatus === "PENDING") return recipientView(row);
  }

  if (row.sessionAttempts >= 3) throw new VerifyMnError("Recipient verification attempt limit reached");
  const { data: claimed, error: claimError } = await createAdminClient()
    .from("recipient_verifications")
    .update({
      status: "CREATING",
      session_attempts: row.sessionAttempts + 1,
      provider_session_id: null,
      sms_uri: null,
      display_instruction: null,
      session_expires_at: null,
      verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("deal_id", row.dealId)
    .eq("share_token_hash", row.shareTokenHash)
    .eq("session_attempts", row.sessionAttempts)
    .select("deal_id")
    .maybeSingle<{ deal_id: string }>();
  if (claimError) throw new Error(`Could not prepare Verify.MN session: ${claimError.message}`);
  if (!claimed) throw new VerifyMnError("Recipient verification was already started");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  let session: VerifyMnSession;
  try {
    session = await client.createSession(row.phone, code);
  } catch (error) {
    const { error: resetError } = await createAdminClient()
      .from("recipient_verifications")
      .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
      .eq("deal_id", row.dealId)
      .eq("share_token_hash", row.shareTokenHash)
      .eq("status", "CREATING");
    if (resetError) throw new Error(`Could not reset failed Verify.MN session creation: ${resetError.message}`);
    throw error;
  }
  const { data, error } = await createAdminClient()
    .from("recipient_verifications")
    .update({
      status: "PENDING",
      provider_session_id: session.sessionId,
      sms_uri: session.smsUri,
      display_instruction: session.displayInstruction,
      session_expires_at: session.expiresAt,
      verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("deal_id", row.dealId)
    .eq("share_token_hash", row.shareTokenHash)
    .select("deal_id")
    .maybeSingle<{ deal_id: string }>();
  if (error) throw new Error(`Could not save Verify.MN session: ${error.message}`);
  if (!data) throw new Error("This recipient verification link has been replaced");
  return {
    status: "PENDING",
    smsUri: session.smsUri,
    displayInstruction: session.displayInstruction,
    inviteExpiresAt: row.inviteExpiresAt,
    sessionExpiresAt: session.expiresAt,
  };
}

async function saveRecipientStatus(
  row: RecipientVerificationRow,
  status: VerifyMnStatus,
  verifiedAt?: string | null,
): Promise<RecipientVerificationView> {
  const { error } = await createAdminClient()
    .from("recipient_verifications")
    .update({
      status,
      verified_at: status === "VERIFIED" ? (verifiedAt ?? new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("deal_id", row.dealId)
    .eq("share_token_hash", row.shareTokenHash);
  if (error) throw new Error(`Could not update recipient verification: ${error.message}`);
  return {
    status,
    inviteExpiresAt: row.inviteExpiresAt,
    sessionExpiresAt: row.sessionExpiresAt,
    smsUri: row.smsUri,
    displayInstruction: row.displayInstruction,
  };
}

/** Re-check the provider's source of truth; the share token only authorizes this one session. */
export async function checkRecipientVerification(token: string): Promise<RecipientVerificationView | null> {
  const row = await recipientInviteByToken(token);
  if (!row) return null;
  if (Date.parse(row.inviteExpiresAt) <= Date.now() && row.status !== "VERIFIED" && row.status !== "EXPIRED") {
    return saveRecipientStatus(row, "EXPIRED");
  }
  if (row.status !== "PENDING" || !row.sessionId || !row.sessionExpiresAt) return recipientView(row);
  if (Date.parse(row.sessionExpiresAt) <= Date.now()) {
    return saveRecipientStatus(row, "EXPIRED");
  }
  const status = await client.getSession(row.sessionId, Date.parse(row.sessionExpiresAt) - Date.now());
  if (status.sessionStatus === "PENDING") return recipientView(row);
  return saveRecipientStatus(row, status.sessionStatus, status.verifiedAt);
}

async function currentUserId(): Promise<string> {
  const viewer = await getViewer();
  if (!viewer) throw new Error("Sign in before starting phone verification");
  return viewer.profile.id;
}

/** Create or reuse this user's live session; callers must show its instruction and smsUri. */
export async function startPhoneVerification(phoneInput: string): Promise<VerifyMnSession> {
  const userId = await currentUserId();
  const phone = normalizePhone(phoneInput);
  const db = createAdminClient();
  const { data: existing, error: lookupError } = await db
    .from("verify_mn_sessions")
    .select("provider_session_id, phone, sms_uri, display_instruction, status, expires_at")
    .eq("user_id", userId)
    .eq("phone", phone)
    .eq("status", "PENDING")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      provider_session_id: string;
      phone: string;
      sms_uri: string;
      display_instruction: string;
      status: VerifyMnStatus;
      expires_at: string;
    }>();
  if (lookupError) throw new Error(`Could not load Verify.MN session: ${lookupError.message}`);
  if (existing) {
    const saved: VerifyMnSession = {
      sessionId: existing.provider_session_id,
      smsUri: existing.sms_uri,
      displayInstruction: existing.display_instruction,
      expiresAt: existing.expires_at,
    };
    const current = await client.getSession(saved.sessionId, Date.parse(saved.expiresAt) - Date.now());
    if (current.sessionStatus === "EXPIRED") {
      await updateStoredStatus(userId, saved.sessionId, "EXPIRED");
    } else {
      if (current.sessionStatus === "VERIFIED") {
        await updateStoredStatus(userId, saved.sessionId, "VERIFIED", current.verifiedAt);
      }
      return saved;
    }
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const session = await client.createSession(phone, code);
  const { error: insertError } = await db.from("verify_mn_sessions").insert({
    provider_session_id: session.sessionId,
    user_id: userId,
    phone,
    sms_uri: session.smsUri,
    display_instruction: session.displayInstruction,
    expires_at: session.expiresAt,
  });
  if (insertError) throw new Error(`Could not save Verify.MN session: ${insertError.message}`);
  return session;
}

async function updateStoredStatus(
  userId: string,
  sessionId: string,
  status: VerifyMnStatus,
  verifiedAt?: string | null,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("verify_mn_sessions")
    .update({
      status,
      verified_at: status === "VERIFIED" ? (verifiedAt ?? new Date().toISOString()) : null,
    })
    .eq("provider_session_id", sessionId)
    .eq("user_id", userId);
  if (error) throw new Error(`Could not update Verify.MN session: ${error.message}`);
}

export async function pollVerifyMnSession(
  sessionId: string,
  expiresAt: string,
  getStatus: (id: string, timeoutMs: number) => Promise<VerifyMnSessionStatus>,
  options: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<VerifyMnSessionStatus | null> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) throw new TypeError("Invalid Verify.MN session expiry");

  while (now() < deadline) {
    const remaining = deadline - now();
    let status: VerifyMnSessionStatus;
    try {
      status = await getStatus(sessionId, remaining);
    } catch (error) {
      if (now() >= deadline) return null;
      const retryable =
        (error instanceof VerifyMnError && (error.status === 429 || (error.status !== undefined && error.status >= 500))) ||
        error instanceof TypeError ||
        (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError"));
      if (!retryable) throw error;
      await sleep(Math.min(POLL_INTERVAL_MS, deadline - now()));
      continue;
    }
    if (status.sessionStatus !== "PENDING") return status;
    const wait = Math.min(POLL_INTERVAL_MS, deadline - now());
    if (wait > 0) await sleep(wait);
  }
  return null;
}

/**
 * Wait for the current user's most recent session for this number. Start it first with
 * startPhoneVerification() so the user can see the exact instruction and open smsUri.
 */
export async function verifyPhone(phoneInput: string): Promise<boolean> {
  const userId = await currentUserId();
  const phone = normalizePhone(phoneInput);
  const db = createAdminClient();
  const { data: session, error } = await db
    .from("verify_mn_sessions")
    .select("provider_session_id, status, expires_at")
    .eq("user_id", userId)
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ provider_session_id: string; status: VerifyMnStatus; expires_at: string }>();
  if (error) throw new Error(`Could not load Verify.MN session: ${error.message}`);
  if (!session) return false;
  if (session.status === "VERIFIED") return true;
  if (session.status === "EXPIRED" || Date.parse(session.expires_at) <= Date.now()) {
    await updateStoredStatus(userId, session.provider_session_id, "EXPIRED");
    return false;
  }

  const result = await pollVerifyMnSession(session.provider_session_id, session.expires_at, (id, timeoutMs) =>
    client.getSession(id, timeoutMs),
  );
  if (!result) {
    await updateStoredStatus(userId, session.provider_session_id, "EXPIRED");
    return false;
  }
  await updateStoredStatus(userId, session.provider_session_id, result.sessionStatus, result.verifiedAt);
  return result.sessionStatus === "VERIFIED";
}
