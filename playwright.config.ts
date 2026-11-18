import { defineConfig } from "@playwright/test";

/**
 * Browser tests against a REAL Supabase project (docs/CONTEXT.md "Testing"). They post and
 * cancel "[verify]" tasks and edit demo profiles, so they must never hit production by accident:
 *
 *   E2E_ENV_FILE=.env.staging.local E2E_CONFIRM_PROJECT=<staging ref> npm run e2e
 *
 * The run refuses to start unless E2E_CONFIRM_PROJECT equals the project ref in that env file.
 * Needs a production build (`npm run build`), the demo users (`npm run seed`) and the dev SMS
 * outbox (the "Send SMS hook" migration). Uses the installed Google Chrome.
 */
const envFile = process.env.E2E_ENV_FILE ?? ".env.local";
process.loadEnvFile(envFile);
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://x").hostname.split(".")[0];
if (process.env.E2E_CONFIRM_PROJECT !== ref) {
  throw new Error(`e2e: refusing to run. ${envFile} points at project "${ref}"; set E2E_CONFIRM_PROJECT=${ref} if that is really the one to test.`);
}

const PORT = Number(process.env.E2E_PORT ?? 3123);

export default defineConfig({
  testDir: "e2e",
  // one flow at a time: they share demo users and the database
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    viewport: { width: 390, height: 844 },
    locale: "mn-MN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    // the app reads the same env file the tests do
    // E2E_DEVICE_BYPASS: test browsers can't hold a push subscription (see src/lib/work-ready.ts); never set it in production
    command: `E2E_DEVICE_BYPASS=1 node --env-file=${envFile} node_modules/next/dist/bin/next start -p ${PORT}`,
    url: `http://localhost:${PORT}/welcome`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
