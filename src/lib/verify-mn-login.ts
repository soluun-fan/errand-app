import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";
import { createVerifyMnClient, type VerifyMnSession } from "./verify-mn";

const name = "verify-mn-login";
const client = createVerifyMnClient();
export const verifyMnLoginEnabled = () => process.env.SMS_PROVIDER === "verify-mn";

type Challenge = VerifyMnSession & { phone: string; token: string };
export type LoginChallengeView = Omit<Challenge, "token">;

function key() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Supabase login is not configured");
  return createHash("sha256").update("verify-mn-login-v1\0").update(secret).digest();
}

function publicView({ phone, sessionId, expiresAt, smsUri, displayInstruction }: Challenge): LoginChallengeView {
  return { phone, sessionId, expiresAt, smsUri, displayInstruction };
}

async function readChallenge(): Promise<Challenge | null> {
  const value = (await cookies()).get(name)?.value;
  if (!value) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const decoded = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
    const challenge: Challenge = JSON.parse(decoded.toString());
    return Date.parse(challenge.expiresAt) > Date.now() ? challenge : null;
  } catch {
    return null;
  }
}

export async function pendingLogin() {
  const challenge = await readChallenge();
  return challenge && publicView(challenge);
}

export async function clearPendingLogin() {
  (await cookies()).set(name, "", { path: "/login", maxAge: 0 });
}

export async function startVerifyMnLogin(phone: string): Promise<LoginChallengeView | null> {
  const current = await readChallenge();
  if (current?.phone === phone) return publicView(current);
  // Supabase rate-limits issuance and consumes this private OTP once. The user sends a separate
  // random message to Verify.MN. Never put the Supabase credential in UI state or the SMS text.
  const auth = await createClient();
  const { error } = await auth.auth.signInWithOtp({ phone });
  if (error) return null;
  const outbox = await createAdminClient().rpc("dev_latest_sms_code", { p_phone: phone });
  if (outbox.error || typeof outbox.data !== "string" || !/^\d{6}$/.test(outbox.data)) return null;
  let text: string;
  do { text = String(randomInt(100000, 1000000)); } while (text === outbox.data);
  const session = await client.createSession(phone, text);
  const expires = Math.min(Date.parse(session.expiresAt), Date.now() + 300_000);
  if (expires <= Date.now()) return null;
  const challenge = { ...session, expiresAt: new Date(expires).toISOString(), phone, token: outbox.data };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(challenge)), cipher.final()]);
  const value = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  (await cookies()).set(name, value, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/login", expires: new Date(expires),
  });
  return publicView(challenge);
}

export async function checkVerifyMnLogin(sessionId: string) {
  const challenge = await readChallenge();
  if (!challenge || challenge.sessionId !== sessionId) return { status: "expired" } as const;
  const status = await client.getSession(challenge.sessionId);
  if (status.sessionStatus === "EXPIRED" || Math.min(Date.parse(challenge.expiresAt), Date.parse(status.expiresAt)) <= Date.now()) {
    await clearPendingLogin();
    return { status: "expired" } as const;
  }
  if (status.sessionStatus === "PENDING") return { status: "pending", view: publicView(challenge) } as const;

  const auth = await createClient();
  const { data, error } = await auth.auth.verifyOtp({ phone: challenge.phone, token: challenge.token, type: "sms" });
  await clearPendingLogin();
  if (error || !data.user) return { status: "expired" } as const;
  return { status: "verified", userId: data.user.id } as const;
}
