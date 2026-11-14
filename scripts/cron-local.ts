/**
 * Development scheduler: calls the local app's /api/cron/tick every 20 s (what Supabase pg_cron
 * does in production). Run alongside `npm run dev`:  npm run cron:local
 */
const url = process.env.TICK_URL ?? "http://localhost:3000/api/cron/tick";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set in .env.local");
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
    console.log(new Date().toLocaleTimeString(), res.status, await res.text());
  } catch (e) {
    console.log(new Date().toLocaleTimeString(), "app not reachable:", (e as Error).message);
  }
}

console.log(`Ticking ${url} every 20 s — Ctrl+C to stop`);
void tick();
setInterval(tick, 20_000);
