import { tickHealth } from "@/lib/health-rules";
import { tickHeartbeat } from "@/lib/scheduler";

/**
 * Public health check for an uptime monitor: 200 while the background tick is running, 503 if it
 * stopped, failed or never ran. Says only "ok" or not — no details, no secrets.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ok = tickHealth(await tickHeartbeat(), Date.now()).state === "ok";
    return Response.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
