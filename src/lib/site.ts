import "server-only";
import { headers } from "next/headers";

/** This deployment's public origin, from the request (Vercel sets x-forwarded-host / -proto). */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Only the production deployment is open to search engines; staging and previews never are. */
export function indexable(): boolean {
  return process.env.VERCEL_ENV === "production" && process.env.APP_ENV !== "staging";
}

/** Pages anyone may open without signing in — the only ones search engines should see. */
export const PUBLIC_PAGES = ["/welcome", "/help", "/safety", "/terms", "/privacy", "/helper-terms"] as const;
