import { runtimeVapidPublicKey } from "@/lib/vapid-env";

/** The Web Push public key (public by design: every browser that turns on notifications needs it). */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ key: runtimeVapidPublicKey() }, { headers: { "cache-control": "no-store" } });
}
