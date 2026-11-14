import { createHmac } from "node:crypto";

/**
 * Short-lived credentials for our own TURN relay (coturn with `use-auth-secret`, the standard
 * "TURN REST API"): username = "<expiry-unix>:<userId>", password = base64(HMAC-SHA1(secret, username)).
 * The relay checks them itself, so nothing long-lived ever reaches a browser.
 */
export function turnCredentials(secret: string, userId: string, nowMs: number, ttlSeconds = 600): { username: string; credential: string } {
  const username = `${Math.floor(nowMs / 1000) + ttlSeconds}:${userId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential };
}
