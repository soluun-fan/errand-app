/**
 * The Web Push public key, read when the server runs — not baked in at build time (2026-11-27:
 * the key was added on Vercel after a build, and the live site kept saying "not set up"). The
 * name goes through a variable so the build can't replace it with whatever it saw then.
 */
const PUBLIC_NAMES = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PUBLIC_KEY"] as const;

export function runtimeVapidPublicKey(): string | null {
  for (const name of PUBLIC_NAMES) {
    const v = process.env[name as string]?.trim();
    if (v) return v;
  }
  return null;
}
