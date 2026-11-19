/**
 * Who may sign in, and whether the one-time code may be shown on screen (docs/deploy.md).
 * Until a real SMS provider is connected, codes are only "sent" to the dev outbox — so on a
 * public deployment only the owner's test phones may sign in, or anyone could log in as anyone.
 */
export interface LoginEnv {
  production: boolean;
  /** A real SMS provider delivers codes (not wired yet). */
  smsLive: boolean;
  /** DEV_SHOW_SMS_CODES=true */
  showCodes: boolean;
  /** TEST_PHONES, normalized to +976XXXXXXXX */
  testPhones: readonly string[];
}

export function loginPolicy(phone: string, env: LoginEnv): { allowed: boolean; showCode: boolean } {
  if (env.smsLive) return { allowed: true, showCode: false }; // never show codes once SMS is real
  if (!env.production) return { allowed: true, showCode: env.showCodes };
  const allowed = env.testPhones.includes(phone);
  return { allowed, showCode: allowed && env.showCodes };
}
