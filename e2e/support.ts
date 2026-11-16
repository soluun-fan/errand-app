import type { BrowserContext, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile, type ProfileRow } from "@/lib/db/mapping";
import type { ErrandDeal } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";

/** Demo accounts from scripts/seed.ts (docs/CONTEXT.md). */
export const PHONES = { solongo: "97688000001", bat: "97688000011", nomin: "97688000012", ops: "97688000099" } as const;
export const NAMES = { solongo: "Solongo B.", bat: "Bat-Erdene G.", nomin: "Nomin A." } as const;

export const db = createAdminClient();

export async function profile(name: string): Promise<ProfileRow & { bio: string | null; from_price: number | null }> {
  const { data, error } = await db.from("profiles").select("*").eq("name", name).single();
  if (error || !data) throw new Error(`demo user "${name}" missing — run npm run seed against this project`);
  return data;
}

type Cookie = { name: string; value: string; domain: string; path: string };
/** One sign-in per phone per run (Supabase allows one code per number per second; sessions last an hour). */
const sessions = new Map<string, Cookie[]>();

/** Signs in through the real phone-OTP flow (code read from the dev outbox) and puts the session cookie in the browser. */
export async function loginAs(context: BrowserContext, phone: string): Promise<void> {
  if (!sessions.has(phone)) sessions.set(phone, await signIn(phone));
  await context.addCookies(sessions.get(phone)!);
}

async function signIn(phone: string): Promise<Cookie[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const sent = await c.auth.signInWithOtp({ phone: `+${phone}` });
  if (sent.error) throw new Error(sent.error.message);
  const { data: code } = await db.rpc("dev_latest_sms_code", { p_phone: phone });
  const { data, error } = await c.auth.verifyOtp({ phone: `+${phone}`, token: String(code), type: "sms" });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  const value = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
  const name = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const chunks: Cookie[] = [];
  for (let i = 0; i * 3180 < value.length; i++) chunks.push({ name: `${name}.${i}`, value: value.slice(i * 3180, (i + 1) * 3180), domain: "localhost", path: "/" });
  return chunks;
}

export const errand = async (id: string) => (await loadDeal(db, id)) as ErrandDeal;

/** Cancels test tasks that are still open (nothing is held while open) — leaves the database tidy. */
export async function cancelIfOpen(ids: string[], customerName: string = NAMES.solongo): Promise<void> {
  const p = await profile(customerName);
  for (const id of ids) {
    const d = await errand(id).catch(() => null);
    if (d && (d.status === "open" || d.status === "awaiting_payment" || d.status === "matched")) {
      await runCommand(db, id, { type: "cancel" }, actorFromProfile(p, Date.now())).catch(() => undefined);
    }
  }
}

/** Fails the test on any uncaught error in the page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

export async function ledgerClean(): Promise<unknown[]> {
  const { data } = await db.rpc("ledger_invariant_violations");
  return data ?? [];
}
