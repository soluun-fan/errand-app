/**
 * Checks the call relay settings (docs/deploy.md "Call relay"): asks Cloudflare for short-lived TURN
 * credentials with CLOUDFLARE_TURN_KEY_ID / CLOUDFLARE_TURN_API_TOKEN and reports what it got.
 * Prints no keys or credentials. Run: npm run check:turn  (or with --env-file=.env.staging.local)
 */
async function main() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  console.log(`CALLS_ENABLED=${process.env.CALLS_ENABLED === "true" ? "true" : "not true (calls stay off)"}`);
  if (!keyId || !token) {
    console.log("FAIL relay: CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN are not both set");
    process.exitCode = 1;
    return;
  }
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: 600 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.log(`FAIL relay: Cloudflare answered ${res.status}${res.status === 401 || res.status === 403 ? " (wrong Token ID or API Token)" : ""}`);
    process.exitCode = 1;
    return;
  }
  const body = (await res.json()) as { iceServers?: { urls: string | string[] }[] | { urls: string | string[] } };
  const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
  const urls = list.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls])).filter((u) => !/:53(\?|$)/.test(u));
  const relays = urls.filter((u) => u.startsWith("turn"));
  const kinds = [...new Set(relays.map((u) => (u.startsWith("turns:") ? "TLS" : /transport=tcp/.test(u) ? "TCP" : "UDP")))];
  console.log(relays.length ? `OK relay: ${relays.length} relay addresses (${kinds.join(", ")})` : "FAIL relay: Cloudflare returned no relay addresses");
  if (!relays.length) process.exitCode = 1;
}

void main().catch((e) => { console.error("FAIL relay:", e instanceof Error ? e.message : "request failed"); process.exitCode = 1; });
