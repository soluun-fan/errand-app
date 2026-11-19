import "server-only";
import { loginPolicy } from "@/lib/login-policy";
import { normalizeMnPhone } from "@/lib/phone";

const testPhones = () =>
  (process.env.TEST_PHONES ?? "")
    .split(",")
    .map((p) => normalizeMnPhone(p.trim()))
    .filter((p): p is string => Boolean(p));

/** Sign-in rules for this environment (see lib/login-policy.ts and docs/deploy.md). */
export function loginRules(phone: string) {
  return loginPolicy(phone, {
    production: process.env.NODE_ENV === "production",
    smsLive: process.env.SMS_PROVIDER === "http" || process.env.SMS_PROVIDER === "verify-mn",
    showCodes: process.env.DEV_SHOW_SMS_CODES === "true",
    testPhones: testPhones(),
  });
}

/** Whether the login page should explain that codes appear on screen (dev / private testing). */
export const devShowSmsCodes = () => process.env.DEV_SHOW_SMS_CODES === "true";

/** The component gallery (/dev/components) exists only in development — never on a deployed site. */
export const devToolsEnabled = () => process.env.NODE_ENV !== "production";
