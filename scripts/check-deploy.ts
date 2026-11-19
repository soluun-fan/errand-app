/**
 * Pre-deploy check (docs/deploy.md): verifies the settings a public deployment needs and refuses
 * unsafe combinations. Prints variable NAMES only — never values.   npm run check:deploy
 */
const env = process.env;
const problems: string[] = [];
const warnings: string[] = [];

const required: [string, "public" | "secret"][] = [
  ["NEXT_PUBLIC_SUPABASE_URL", "public"],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public"],
  ["SUPABASE_SECRET_KEY", "secret"],
  ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public"],
  ["VAPID_PRIVATE_KEY", "secret"],
  ["VAPID_SUBJECT", "public"],
  ["CRON_SECRET", "secret"],
];
for (const [name] of required) if (!env[name]) problems.push(`${name} is missing`);

if ((env.CRON_SECRET ?? "").length < 32) problems.push("CRON_SECRET must be at least 32 characters");
if (env.NEXT_PUBLIC_SUPABASE_URL && !/^https:\/\//.test(env.NEXT_PUBLIC_SUPABASE_URL)) problems.push("NEXT_PUBLIC_SUPABASE_URL must be the hosted https URL, not localhost");
if (/example\.com/.test(env.VAPID_SUBJECT ?? "")) warnings.push("VAPID_SUBJECT is a placeholder — set a real contact (mailto:you@yourdomain) before launch");

const smsLive = Boolean(env.SMS_PROVIDER) && env.SMS_PROVIDER !== "outbox";
const testPhones = (env.TEST_PHONES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
if (!smsLive) {
  if (!testPhones.length) problems.push("No real SMS provider yet → set TEST_PHONES (comma-separated) or nobody can sign in");
  else warnings.push(`Private testing: only ${testPhones.length} TEST_PHONES number(s) can sign in`);
} else {
  if (env.DEV_SHOW_SMS_CODES === "true") problems.push("DEV_SHOW_SMS_CODES must be off once real SMS is live");
  if (env.SMS_PROVIDER === "verify-mn") {
    if (!env.VERIFY_MN_API_KEY?.trim()) problems.push("VERIFY_MN_API_KEY is required for Verify.MN login");
  } else if (env.SMS_PROVIDER === "http") {
    if (!/^https:\/\//.test(env.SMS_HTTP_URL ?? "")) problems.push("SMS_HTTP_URL must be the gateway's https URL");
    if (!/^v1,whsec_/.test(env.SEND_SMS_HOOK_SECRET ?? "")) problems.push("SEND_SMS_HOOK_SECRET must be the 'v1,whsec_…' secret from Supabase → Auth Hooks");
    if (env.SMS_HTTP_HEADERS) {
      try {
        JSON.parse(env.SMS_HTTP_HEADERS);
      } catch {
        problems.push("SMS_HTTP_HEADERS is not valid JSON");
      }
    }
  } else {
    problems.push("SMS_PROVIDER must be verify-mn, http, or outbox");
  }
}
if (env.E2E_DEVICE_BYPASS) problems.push("E2E_DEVICE_BYPASS is for browser tests only — remove it (it would let helpers skip the phone / location / notification check)");
if ((env.PAYMENT_PROVIDER ?? "mock") === "mock") warnings.push("PAYMENT_PROVIDER=mock — payments are simulated (fine for testing, NOT for real users)");
const cfTurn = Boolean(env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN);
if (!cfTurn && (!env.TURN_URLS || !env.TURN_SECRET)) warnings.push("No call relay — calls are direct (often fail on mobile data; each side can see the other's IP). Set CLOUDFLARE_TURN_KEY_ID + 🔒 CLOUDFLARE_TURN_API_TOKEN");

console.log("\nSet these in Vercel → Project → Settings → Environment Variables (values from your .env.local):");
for (const [name, kind] of required) console.log(`  ${kind === "secret" ? "🔒" : "  "} ${name}${kind === "secret" ? "   (mark as Sensitive)" : ""}`);
console.log(
  "     PAYMENT_PROVIDER" +
    (env.SMS_PROVIDER === "verify-mn" ? ", SMS_PROVIDER, 🔒 VERIFY_MN_API_KEY" : smsLive ? ", SMS_PROVIDER, 🔒 SMS_HTTP_URL, SMS_HTTP_METHOD/BODY, 🔒 SMS_HTTP_HEADERS, 🔒 SEND_SMS_HOOK_SECRET" : ", TEST_PHONES, DEV_SHOW_SMS_CODES") +
    (cfTurn ? ", CLOUDFLARE_TURN_KEY_ID, 🔒 CLOUDFLARE_TURN_API_TOKEN" : env.TURN_URLS ? ", 🔒 TURN_URLS, 🔒 TURN_SECRET" : "") +
    (env.PAYMENT_PROVIDER === "wire" ? ", 🔒 WIRE_SECRET_KEY, 🔒 WIRE_WEBHOOK_SECRET" : ""),
);
if (warnings.length) console.log("\nWarnings:\n" + warnings.map((w) => `  ⚠ ${w}`).join("\n"));
if (problems.length) {
  console.log("\nNot ready:\n" + problems.map((p) => `  ✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("\n✓ Ready to deploy");
