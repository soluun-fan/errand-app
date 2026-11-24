# Deploying Tuslamj (Vercel)

This is a **private test deployment**. Demo SMS codes are limited to `TEST_PHONES`; when real Verify.MN phone verification is enabled, any valid Mongolian number can sign in. Payments default to simulation; Wire can be enabled for an isolated test deployment. The optional helper test mode lets any adult with a verified phone work without ID or bank details and must remain off for public launch.

Use a **separate Supabase staging project and Vercel Preview environment** for testing schema changes, helper access, or Wire payments. The existing production database may contain real user and payment data. Never apply pending migrations to it as part of a test; inspect migrations first and apply them to staging. Set Preview's Supabase URL and keys to the staging project, not production.

The app runs in Vercel's **Seoul region (`icn1`)**, next to the Supabase database (`ap-northeast-2`). This is set in `vercel.json`.

## Before you start

1. Add your test phones to `.env.local`: your own number plus any test accounts, comma-separated.
   ```
   TEST_PHONES=99112233,97688000001,97688000011,97688000099
   ```
   To test helper tasks without collecting ID documents or bank details, set `UNVERIFIED_HELPERS_TEST_MODE=true` in the protected test deployment. Any signed-in account that confirms age 18+ can enable helper access; there is deliberately no demo-phone allowlist for helpers. The app labels these profiles as not identity-checked, disables withdrawals, and displays a private-test warning. Do not enable this on a public launch.
2. Set a real contact for push notifications in `.env.local`, for example `VAPID_SUBJECT=mailto:you@yourmail.com`.
3. Check everything:
   ```bash
   npm run check:deploy
   ```
   It must end with `✓ Ready to deploy`.    Warnings about mock payments and the missing call relay are expected unless you are configuring an isolated Wire test.
4. Commit and push to GitHub as usual.

## On vercel.com (about 10 minutes)

1. Sign up with **"Continue with GitHub"**. This creates the account; there's nothing to install.
2. **Add New → Project** → choose the `errand-app` repository → **Import**. The framework is detected as Next.js; leave the build settings as they are.
3. Before clicking Deploy, open **Environment Variables**. Copy each value from your `.env.local`; **never paste them in a chat**. Tick **Sensitive** for the 🔒 ones:

   | Name | Note |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | |
   | 🔒 `SUPABASE_SECRET_KEY` | Sensitive |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | |
   | 🔒 `VAPID_PRIVATE_KEY` | Sensitive |
   | `VAPID_SUBJECT` | your real contact |
   | 🔒 `CRON_SECRET` | Sensitive |
   | `TEST_PHONES` | the only numbers that can sign in |
   | `UNVERIFIED_HELPERS_TEST_MODE` | `true` only for private testing; any phone-verified adult may self-activate without ID or bank details |
   | `DEV_SHOW_SMS_CODES` | `true`: codes appear on screen, **only for `TEST_PHONES`** |
   | `PAYMENT_PROVIDER` | `mock` for the default safe test; use `wire` only in isolated staging with Wire credentials and webhook configured |
   | 🔒 `WIRE_SECRET_KEY` | Required only when `PAYMENT_PROVIDER=wire`; treat as a live payment credential |
   | 🔒 `WIRE_WEBHOOK_SECRET` | Required only when `PAYMENT_PROVIDER=wire`; webhook signing secret |

4. Click **Deploy**. When it finishes you get an address like `https://errand-app-xxxx.vercel.app`.

## After the first deploy

1. Start the background scheduler. Run this on your Mac once, with your Vercel address:
   ```bash
   npm run scheduler:configure -- https://errand-app-xxxx.vercel.app
   npm run scheduler:configure -- --status
   ```
   About 20 seconds later, `heartbeat.last_ok_at` should be recent.
2. In **Supabase → Authentication → URL Configuration**, set the **Site URL** to the same address.
3. Test on your phone:
   1. Open the address and choose **Add to Home Screen**. iPhones only allow notifications for an installed app.
   2. Sign in with a number from `TEST_PHONES`.
   3. Allow notifications and location.
   4. Post a task as the customer, then do it as a helper from a second phone.

Every `git push` to `main` redeploys automatically. Changed environment variables only take effect after a redeploy (Deployments → ⋯ → Redeploy).

## Verify.MN phone sign-in

For localhost, set these in `.env.local` and restart the Next.js server. For a hosted deployment, use its server environment and redeploy.

```dotenv
SMS_PROVIDER=verify-mn
VERIFY_MN_API_KEY=your_private_key
DEV_SHOW_SMS_CODES=false
```

Use the existing Supabase **Postgres Send SMS hook** `public.send_sms_hook` with phone sign-in enabled. The server retrieves the private Supabase OTP through the service-role RPC and binds it to the Verify.MN challenge in a short-lived encrypted HttpOnly cookie. Set every app sharing this project's Auth to keep real users' OTPs private. The browser shows a separate Verify.MN message. The user sends it to 144773 from the SIM they entered and pays 150₮ for each SMS. The server polls Verify.MN, then exchanges the private OTP once for a normal Supabase session. This flow works on localhost without a public callback or HTTP SMS gateway.

## Verify.MN delivery recipients

On an active delivery task, the customer can optionally create a private verification link for the recipient. The recipient opens it on their own phone, sees the exact Verify.MN instruction and SMS link, and chooses when to start; the app polls the provider's status endpoint. The share token is stored as a hash and tied to the task. No callback URL is registered. Session creation is limited to three attempts per link; creating a replacement link resets that limit and invalidates the previous link. Link creation and SMS sending are separate: only the recipient's tap on the verification page starts a paid-phone flow.

Set `VERIFY_MN_API_KEY` as a server-only secret in `.env.local` or Vercel Environment Variables. Never use a `NEXT_PUBLIC_` name, commit the key, or paste it into chat. The customer flow discloses that each SMS to `144773` costs the recipient `150₮` before they start, shows `displayInstruction` verbatim, offers `smsUri`, and tells them to send from the number being verified. The recipient link verifies a delivery contact. Account sign-in uses its own browser-bound challenge.

## Safety built in

- Codes on screen and sign-in are limited to `TEST_PHONES` until a real SMS provider is connected (`src/lib/login-policy.ts`). Without that limit, anyone could log in as any number.
- Security headers: no embedding in other sites, and camera, microphone and location are allowed only for this site (`next.config.ts`).
- The developer gallery (`/dev/components`) doesn't exist on a deployed site.
- **Emergency switches** at `/ops/safety` (admins): pause new tasks, freeze all money movements, caps per task / per customer per day / platform-wide. They work instantly, with no redeploy, and every change is logged.
- **SOS** on every live task: 102 / 103 and an alert to Ops with the phone's position. Turn on notifications for your admin account at **Profile → Operations** on the phone you carry.
- Secrets are only in Vercel's encrypted settings and Supabase Vault (the scheduler secret), never in git.

## Backups on the free plan

`.github/workflows/backup.yml` runs every night at 02:00 Ulaanbaatar time: it dumps the production
database (app data and login accounts, not uploaded photos), encrypts it so **only your private key
can open it**, and keeps it 30 days under GitHub → Actions → Backup → the run → Artifacts.

One-time setup on your Mac:
1. `brew install age`, then `age-keygen -o ~/guigeeree-backup-key.txt`. It prints a public key
   (`age1…`). **Keep the key file safe and copy it somewhere off this Mac** (USB or password
   manager): without it no backup can be opened.
2. GitHub → errand-app → Settings → Secrets and variables → Actions → New repository secret:
   - `AGE_RECIPIENT` = the public key `age1…`
   - `BACKUP_DB_URL` = Supabase → your project → **Connect** → **Session pooler** connection string,
     with the database password filled in.
3. Actions → Backup → **Run workflow** once and check it turns green.

Restore (practise once on staging, then monthly):
1. Download the artifact, unzip it, then `age -d -i ~/guigeeree-backup-key.txt -o db.dump db-….dump.age`.
2. `pg_restore --no-owner --no-privileges --clean --if-exists --dbname "<target connection string>" db.dump`.
   Restore into staging first; restoring into production replaces its data.
3. Delete `db.dump` afterwards: it holds personal data unencrypted.

## Staging (test changes before production)

The staging project is **errand-extra** (Supabase ref `ivaoltwgzxntytqnwkih`). Its keys live in the
git-ignored `.env.staging.local`; production stays linked (`supabase/.temp/project-ref`).

- `npm run staging:migrate`: apply new migrations to staging **first**, then production with
  `npx supabase db push --remote`.
- `npm run staging:check`: the same read-only checks as `check:live`, against staging.
- `npm run staging:seed`: the demo users and one demo task (safe to repeat; skips if deals exist).
- `npm run staging:dev`: run the app on your Mac against staging.
- `npm run staging:build` then `npm run staging:e2e`: the browser tests against staging. The build
  bakes the staging address into the page code, so run `npm run build` again before using a local
  production build against your own `.env.local`. Demo numbers sign in with Supabase's fixed test
  code (pushed with `supabase config push --remote=ivaoltwgzxntytqnwkih`).
- Phone login on staging: Supabase → errand-extra → Authentication → Providers → Phone → add
  **test phone numbers** (the seed's +976 8800 00xx numbers) with a fixed code, or connect the same
  Send SMS hook as production. Never point a public deployment at staging.

## Go-live checklist (100-person pilot)

Do these in order. Each step says who does it. Values are pasted into Vercel → Settings → Environment Variables (🔒 = tick **Sensitive**), never into chat or git. After changing variables: Deployments → ⋯ → **Redeploy**.

### 1. Plans (you, ~10 min)
- [ ] **Free plans for now (owner, 2026-11-23: no paid plans until the app succeeds).** What covers the gaps:
  - Backups: the nightly encrypted backup below (Supabase Free keeps none).
  - Limits: `npm run check:live` shows database and file use against the free 500 MB / 1 GB; upgrade at 70%.
  - Pausing: Supabase pauses idle free projects; the 20-second scheduler and the uptime monitor keep it active.
- [ ] **Vercel Pro** (≈ $20/month, owner 2026-11-23): Hobby doesn't allow commercial use. The region is already Seoul (`vercel.json`).
- [ ] Later, when it pays for itself: **Supabase Pro** (≈ $25/month, daily backups).
- [ ] Deploy as in "On vercel.com" above, then run `npm run scheduler:configure -- https://<your address>` and check `--status`. Without this, nothing auto-confirms, expires, refunds or pays out.
- [ ] Optional but recommended: your own domain (Vercel → Domains), then run `scheduler:configure` again with it.

### 2. Real SMS (you + gateway, ~1 hour)
1. Open an account with a Mongolian SMS gateway and get its "send one SMS" API (URL, key, parameters).
2. Fill these in (`src/lib/sms.ts` explains each; `{phone}` = 976XXXXXXXX, `{phone_local}` = XXXXXXXX, `{text}` = the message):

   | Name | Example |
   |---|---|
   | `SMS_PROVIDER` | `http` |
   | 🔒 `SMS_HTTP_URL` | `https://api.gateway.mn/send?key=KEY&to={phone_local}&text={text}` |
   | `SMS_HTTP_METHOD` | `GET` (or `POST` + `SMS_HTTP_BODY`) |
   | 🔒 `SMS_HTTP_HEADERS` | `{"Authorization":"Bearer KEY"}` (only if the gateway wants it) |
   | `SMS_HTTP_OK` | text the gateway's reply contains on success (optional) |

3. Supabase → **Authentication → Hooks → Send SMS** → type **HTTPS**, URL `https://<your address>/api/auth/sms` → **Generate secret** → copy it into 🔒 `SEND_SMS_HOOK_SECRET` (starts with `v1,whsec_`).
4. Remove `TEST_PHONES` and `DEV_SHOW_SMS_CODES`, redeploy, `npm run check:deploy` must pass.
5. Test with your own phone. A failed send shows up at **Ops → Алдаа** (the code itself is never logged).

### 3. Call relay (you, ~10 min) — so calls work on mobile data
1. Cloudflare dashboard → **Realtime → TURN Server** → **Create** → copy the **Turn Token ID** and **API Token**.
2. Set `CLOUDFLARE_TURN_KEY_ID`, 🔒 `CLOUDFLARE_TURN_API_TOKEN`, and `CALLS_ENABLED=true`, then redeploy. Calls use TURN relay-only. If the relay can't be reached, calls fail rather than falling back to a direct connection.
3. Test: a call between two phones on mobile data (Wi-Fi off).

Until a TURN relay is configured and tested, leave `CALLS_ENABLED` unset or `false`. Text chat and voice messages remain available.

### 4. Payments: wire.mn (you + wire.mn)
See "Going live with wire.mn" below. The customer prepays the full amount (managed service); helpers withdraw their earnings, which Ops sends at **Ops → Татан авалт**.

### 5. Watching it (you, ~5 min, then daily)
- [ ] On the phone you carry: log in as Ops, add the app to the Home Screen, **Profile → Operations → notifications on**. You then get a push for: SOS, new helper applications, withdrawals to send, "not paid" reports, reported photos and **every new kind of error** (built in; listed at **Ops → Алдаа**).
- [ ] A free uptime monitor (e.g. UptimeRobot) on `https://<your address>/api/health` — it alerts you if the background jobs stop.
- [ ] Someone checks **Ops** at least morning, noon and evening: withdrawals (target 15 min in opening hours), applications, disputes, errors.

### 6. Rules already enforced by the app
- Helpers work only from a **phone** with **notifications and location on** — otherwise they see a "get ready" checklist instead of the online switch, and the server refuses going online, applying and starting. iPhones need the app added to the Home Screen first (the checklist explains it).
- Customers are asked to turn on notifications on Home (they can still post from a laptop).
- `E2E_DEVICE_BYPASS` exists only for browser tests; `check:deploy` refuses it.

### Still for you / the lawyer
- [ ] Terms of service and the privacy policy (lawyer); company details in the footer.
- [ ] Native review of the Mongolian text.
- [ ] Caps at `/ops/safety` for the pilot size.

## Health check
- `/ops` shows "Background jobs: ✓ running / ⚠️ stopped". Stopped = expiries, auto-confirm, refunds and payouts aren't happening.
- `GET /api/health` → 200 `{ok:true}` while the tick runs, 503 otherwise (no details).
- `npm run check:live` performs read-only checks against the configured Supabase API: tracking,
  presence, recipient verification and scheduler health. It reads no user records and prints no
  secrets. A successful web build does not prove the deployed database has the required schema.

## Worker location tracking

- Requires `20261119040000_task_privacy.sql`, including `job_locations`, the sharing RPC and the
  trigger that deletes sharing when work ends or the assigned helper changes. Apply the reviewed
  migration before deploying the UI. Do not blindly push all pending migrations: some change money
  and account rules. Test schema changes separately before applying them to the live database.
- A helper starts an active job, taps **Share my location with this customer**, and grants browser
  location permission. Only that task's customer can read the location. Dispatch presence is kept
  separate and is never used as a fallback for customer tracking.
- The shared app layout sends fresh samples every 15 seconds while sharing a job, or every minute
  while online for nearby offers. Updates continue while navigating within the app, including chat.
  Stationary helpers still send updates. Updates pause while the app is hidden or the screen is
  locked; a web app does not provide reliable background GPS tracking.
- Customers refresh active work every 10 seconds. Positions expire after 90 seconds on the client
  even if the network fails. The map shows waiting, stopped, paused or unavailable states instead
  of representing old coordinates as live. Tasks without a destination pin can still show a helper.
- Stopping sharing deletes the row; delayed samples cannot insert it again. Missing tracking or
  recipient-verification tables no longer prevent opening the task page. Missing features remain
  unavailable until the database is repaired.
- If a table exists in Postgres but the API reports `PGRST205`, check privileges and reload the
  PostgREST schema cache with `NOTIFY pgrst, 'reload schema';`, then rerun `npm run check:live`.

## Testing wire.mn (payments)

wire.mn has **no test mode**, so a Wire checkout can move real money. Test only from a separate staging deployment and database; do not turn it on in production just to test the integration. In direct-pay mode, the app checkout collects the in-app amount and the customer pays the helper separately as shown in the task.

1. Finish wire.mn's onboarding (request → review → e-contract) and connect the payment operators you want.
2. Set `PAYMENT_PROVIDER=wire` and 🔒 `WIRE_SECRET_KEY` (`sk_live_…`).
3. Register the webhook (prints the signing secret once): `npm run wire:webhook -- https://<your address>`, put the `whsec_…` into 🔒 `WIRE_WEBHOOK_SECRET`, redeploy, **verify the endpoint** in the wire.mn dashboard.
4. With Wire's approval and a known small amount, make one real payment from a tester account, verify the task settles once, then test cancellation/refund on staging and confirm the provider reports the refund.
5. Watch **Ops → Төлбөр** for refunds wire couldn't finish on its own.

Safety: with `PAYMENT_PROVIDER=wire` and a missing key, paying fails with a message — it never falls back to the simulated button. A payment counts only when wire's signed notification (or our own check with wire) says so; a payment that arrives after the task moved on is refunded in full.
