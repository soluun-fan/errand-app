/**
 * Registers our webhook address with wire.mn (docs/deploy.md "Going live with wire.mn").
 *   npm run wire:webhook -- https://your-app.vercel.app
 * Needs WIRE_SECRET_KEY (sk_live_…) in .env.local. wire shows the signing secret (whsec_…) ONCE:
 * put it in .env.local and in Vercel as WIRE_WEBHOOK_SECRET (Sensitive). Never paste it in a chat.
 * Afterwards verify the endpoint in the wire.mn dashboard (it starts as "pending").
 */
const base = process.argv[2];
const key = process.env.WIRE_SECRET_KEY;
if (!base || !/^https:\/\/[^/]+$/.test(base.replace(/\/$/, ""))) {
  console.error("Usage: npm run wire:webhook -- https://your-app.vercel.app   (https, no path)");
  process.exit(1);
}
if (!key?.startsWith("sk_live_")) {
  console.error("Set WIRE_SECRET_KEY=sk_live_… in .env.local first (wire.mn has live keys only).");
  process.exit(1);
}
const url = `${base.replace(/\/$/, "")}/api/payments/wire`;
const res = await fetch("https://api.wire.mn/v1/webhook_endpoints", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `webhook-${url}` },
  body: JSON.stringify({ url, enabled_events: ["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled", "charge.refunded"] }),
});
const body = (await res.json().catch(() => null)) as { id?: string; secret?: string; status?: string; error?: { message?: string } } | null;
if (!res.ok) {
  console.error(`wire.mn refused (${res.status}): ${body?.error?.message ?? "unknown error"}`);
  process.exit(1);
}
console.log(`✓ Registered ${url} (id ${body?.id}, status ${body?.status ?? "pending"})`);
if (body?.secret) {
  console.log("\nSigning secret (shown only now): add it as WIRE_WEBHOOK_SECRET in .env.local and in Vercel (Sensitive):\n");
  console.log(`  ${body.secret}\n`);
} else {
  console.log("No secret in the reply (already registered?). Use the one you saved, or rotate it in the wire.mn dashboard.");
}
console.log("Then verify the endpoint in the wire.mn dashboard.");
