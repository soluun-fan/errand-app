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
} else if (env.DEV_SHOW_SMS_CODES === "true") {
  problems.push("DEV_SHOW_SMS_CODES must be off once real SMS is live");
}
if ((env.PAYMENT_PROVIDER ?? "mock") === "mock") warnings.push("PAYMENT_PROVIDER=mock — payments are simulated (fine for testing, NOT for real users)");
if (!env.TURN_URLS || !env.TURN_SECRET) warnings.push("No TURN relay — calls are direct (may fail on mobile data; each side can see the other's IP)");

console.log("\nSet these in Vercel → Project → Settings → Environment Variables (values from your .env.local):");
for (const [name, kind] of required) console.log(`  ${kind === "secret" ? "🔒" : "  "} ${name}${kind === "secret" ? "   (mark as Sensitive)" : ""}`);
console.log("     TEST_PHONES, DEV_SHOW_SMS_CODES, PAYMENT_PROVIDER" + (env.TURN_URLS ? ", 🔒 TURN_URLS, 🔒 TURN_SECRET" : ""));
if (warnings.length) console.log("\nWarnings:\n" + warnings.map((w) => `  ⚠ ${w}`).join("\n"));
if (problems.length) {
  console.log("\nNot ready:\n" + problems.map((p) => `  ✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("\n✓ Ready to deploy");
