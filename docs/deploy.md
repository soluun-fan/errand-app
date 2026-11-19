# Deploying Tuslamj (Vercel)

This is a **private test deployment**. Only listed test phone numbers can use phone OTP. Payments are simulated. The checklist at the end covers what has to change before real users.

The app runs in Vercel's **Seoul region (`icn1`)**, next to the Supabase database (`ap-northeast-2`). This is set in `vercel.json`.

## Before you start

1. Add your test phones to `.env.local`: your own number plus any test accounts, comma-separated.
   ```
   TEST_PHONES=99112233,97688000001,97688000011,97688000099
   ```
2. Set a real contact for push notifications in `.env.local`, for example `VAPID_SUBJECT=mailto:you@yourmail.com`.
3. Check everything:
   ```bash
   npm run check:deploy
   ```
   It must end with `✓ Ready to deploy`. Warnings about mock payments and the missing call relay are expected for now.
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
   | `DEV_SHOW_SMS_CODES` | `true`: codes appear on screen, **only for `TEST_PHONES`** |
   | `PAYMENT_PROVIDER` | `mock` |

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

## Go-live checklist (100-person pilot)

Do these in order. Each step says who does it. Values are pasted into Vercel → Settings → Environment Variables (🔒 = tick **Sensitive**), never into chat or git. After changing variables: Deployments → ⋯ → **Redeploy**.

### 1. Plans (you, ~10 min)
- [ ] **Supabase Pro** (≈ $25/month): Supabase → Organization → Billing. Free projects pause after a week without use and have no proper backups.
- [ ] **Vercel Pro** (≈ $20/month): the free plan doesn't allow commercial use. The region is already Seoul (`vercel.json`).
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
2. Set `CLOUDFLARE_TURN_KEY_ID` and 🔒 `CLOUDFLARE_TURN_API_TOKEN`, redeploy. Calls then go through Cloudflare's relay (works behind mobile networks; neither side sees the other's address). If Cloudflare can't be reached, a call still tries directly.
3. Test: a call between two phones on mobile data (Wi-Fi off).

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

## Going live with wire.mn (payments)

How money moves (docs/decisions.md 2026-11-18 "Managed service"): when choosing a helper the customer pays **the full amount** — price + shopping budget + service & safety fee — through wire.mn. After they confirm, the helper's earnings grow; helpers withdraw to their own checked bank account and Ops sends it from the business bank app. Refunds (helper backs out, unused shopping money, disputes) go back through wire.mn automatically.

1. Finish wire.mn's onboarding (request → review → e-contract) and connect the payment operators you want.
2. Set `PAYMENT_PROVIDER=wire` and 🔒 `WIRE_SECRET_KEY` (`sk_live_…`).
3. Register the webhook (prints the signing secret once): `npm run wire:webhook -- https://<your address>`, put the `whsec_…` into 🔒 `WIRE_WEBHOOK_SECRET`, redeploy, **verify the endpoint** in the wire.mn dashboard.
4. wire.mn has no test mode: make one small real payment yourself, confirm it shows as paid, then cancel with a helper back-out and check the refund arrives.
5. Watch **Ops → Төлбөр** for refunds wire couldn't finish on its own.

Safety: with `PAYMENT_PROVIDER=wire` and a missing key, paying fails with a message — it never falls back to the simulated button. A payment counts only when wire's signed notification (or our own check with wire) says so; a payment that arrives after the task moved on is refunded in full.
