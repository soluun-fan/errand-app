/**
 * Production scheduler setup (run once after deploying, and again if the URL or secret changes):
 *   npm run scheduler:configure -- https://your-domain.mn
 * Stores the tick URL and CRON_SECRET (from .env.local) in Supabase — the secret goes into the
 * encrypted Vault — so pg_cron starts calling the app every 20 s. Nothing is written to git.
 *   npm run scheduler:configure -- --status     shows the configuration and the last runs
 */
import { createClient } from "@supabase/supabase-js";

const arg = process.argv[2];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const secret = process.env.CRON_SECRET;
if (!url || !key || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / CRON_SECRET in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  if (arg && arg !== "--status") {
    const base = arg.replace(/\/+$/, "");
    if (!/^https:\/\/[^\s/]+$/.test(base)) {
      console.error("Give the app's public https address, e.g. https://tuslamj.mn");
      process.exit(1);
    }
    const { error } = await db.rpc("configure_scheduler", { p_url: `${base}/api/cron/tick`, p_secret: secret });
    if (error) throw new Error(error.message);
    console.log("Scheduler configured →", `${base}/api/cron/tick`);
  }
  const { data, error } = await db.rpc("scheduler_status");
  if (error) throw new Error(error.message);
  console.log(JSON.stringify(data, null, 2));
})().catch((e) => {
  console.error("Failed:", (e as Error).message);
  process.exit(1);
});
