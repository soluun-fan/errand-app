import type { BrowserContext, Page } from "@playwright/test";
import { LEGAL_VERSIONS } from "@/lib/legal-rules";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile, type ProfileRow } from "@/lib/db/mapping";
import type { ErrandDeal } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { MODE_COOKIE, modeCookieValue, type AppMode } from "@/lib/mode-cookie";

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
export async function loginAs(context: BrowserContext, phone: string, opts: { fresh?: boolean; mode?: AppMode } = {}): Promise<void> {
  // demo accounts have finished registration (current Terms / Privacy / Helper agreement); a
  // `fresh` account goes through it in the browser (onboarding.spec.ts)
  if (!opts.fresh) {
    const { data: p } = await db.from("profiles").select("id, age_confirmed_at").eq("phone", phone).maybeSingle<{ id: string; age_confirmed_at: string | null }>();
    if (p) {
      await db
        .from("profiles")
        .update({ age_confirmed_at: p.age_confirmed_at ?? new Date().toISOString(), terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy, helper_terms_version: LEGAL_VERSIONS.helper })
        .eq("id", p.id);
    }
  }
  if (!sessions.has(phone)) sessions.set(phone, await signIn(phone));
  // Account switching must not leave surplus cookie chunks from the previous session.
  await context.clearCookies({ name: /^sb-.*-auth-token(?:\.\d+)?$/ });
  await context.addCookies(sessions.get(phone)!);
  if (opts.mode) {
    const { data, error } = await db.from("profiles").select("id").eq("phone", phone).single<{ id: string }>();
    if (error || !data) throw new Error("Cannot set test mode without an account");
    await context.addCookies([{ name: MODE_COOKIE, value: modeCookieValue(data.id, opts.mode), domain: "localhost", path: "/" }]);
  }
  // test browsers can't hold a real push subscription: the test server (E2E_DEVICE_BYPASS=1) skips
  // the phone / notifications / location check for this cookie. Production ignores it.
  // work-ready.spec.ts removes it to test the check itself.
  await context.addCookies([{ name: "e2e-device", value: "ok", domain: "localhost", path: "/" }]);
}

/**
 * Sessions kept between runs (git-ignored): each test phone signs in with a code once, later runs
 * refresh that session instead — Supabase limits how many login codes may be sent per hour.
 */
const SAVED = join(process.cwd(), "e2e", ".auth", "sessions.json"); // tests run from the repo root
function saved(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(SAVED, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}
function save(phone: string, refreshToken: string) {
  mkdirSync(dirname(SAVED), { recursive: true });
  writeFileSync(SAVED, JSON.stringify({ ...saved(), [phone]: refreshToken }), { mode: 0o600 });
}

async function signIn(phone: string): Promise<Cookie[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  let session = null;
  // sessions are kept per project, so local and staging runs don't overwrite each other
  const key = `${new URL(url).hostname.split(".")[0]}:${phone}`;
  const token = saved()[key];
  if (token) session = (await c.auth.refreshSession({ refresh_token: token })).data.session;
  if (!session) {
    const sent = await c.auth.signInWithOtp({ phone: `+${phone}` });
    if (sent.error) throw new Error(sent.error.message);
    const { data: code } = await db.rpc("dev_latest_sms_code", { p_phone: phone });
    // hosted test projects use Supabase's fixed test codes for the demo numbers (config.toml
    // [auth.sms.test_otp]), which never reach the SMS outbox
    const otp = code ? String(code) : (process.env.E2E_FIXED_OTP ?? "123456");
    const { data, error } = await c.auth.verifyOtp({ phone: `+${phone}`, token: otp, type: "sms" });
    if (error || !data.session) throw new Error(error?.message ?? "no session");
    session = data.session;
  }
  save(key, session.refresh_token);
  const data = { session };
  const value = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
  const name = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const chunks: Cookie[] = [];
  for (let i = 0; i * 3180 < value.length; i++) chunks.push({ name: `${name}.${i}`, value: value.slice(i * 3180, (i + 1) * 3180), domain: "localhost", path: "/" });
  return chunks;
}

export const errand = async (id: string) => (await loadDeal(db, id)) as ErrandDeal;

/** Cancels test tasks that are still open (nothing is held while open) — leaves the database tidy. */
export async function cancelIfOpen(ids: string[]): Promise<void> {
  for (const id of ids) await closeDeal(id);
}

/**
 * Ends a test task whatever state it was left in, so leftovers never count toward the demo
 * customer's "3 active tasks" limit (2026-11-24: three stuck "[verify] on my way" tasks blocked
 * every posting test). Before a helper: the customer cancels. On the job: the helper reports the
 * customer absent and the system closes it. Waiting for the check: the customer confirms.
 */
export async function closeDeal(id: string): Promise<void> {
  const d = await errand(id).catch(() => null);
  if (!d) return;
  const actor = async (userId: string | null) => {
    const { data } = await db.from("profiles").select("*").eq("id", userId ?? "").single<ProfileRow>();
    return data ? actorFromProfile(data, Date.now()) : null;
  };
  try {
    if (d.status === "open" || d.status === "awaiting_payment" || d.status === "matched") {
      const c = await actor(d.customerId);
      if (c) await runCommand(db, id, { type: "cancel" }, c);
    } else if (d.status === "in_progress") {
      const h = await actor(d.helperId);
      if (h && !d.absentAt) await runCommand(db, id, { type: "customer_absent" }, h);
      await db.from("deals").update({ absent_at: new Date(Date.now() - 3_600_000).toISOString() }).eq("id", id);
      await runCommand(db, id, { type: "absent_cancel" }, { kind: "system" });
    } else if (d.status === "check") {
      const c = await actor(d.customerId);
      if (c) await runCommand(db, id, { type: "confirm" }, c);
    }
  } catch {
    /* best effort: a test that needs a clean slate checks for itself */
  }
}

/** Every "[verify]" task still running from an earlier (interrupted) run. */
export async function closeLeftovers(): Promise<number> {
  const { data } = await db.from("deals").select("id").like("title", "[verify]%").in("status", ["open", "awaiting_payment", "matched", "in_progress", "check"]);
  for (const r of data ?? []) await closeDeal(r.id as string);
  return data?.length ?? 0;
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
