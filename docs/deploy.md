# Deploying Tuslamj (Vercel)

This is a **private test deployment**. Only the phone numbers you list can sign in, and payments are simulated. The checklist at the end covers what has to change before real users.

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

## Safety built in

- Codes on screen and sign-in are limited to `TEST_PHONES` until a real SMS provider is connected (`src/lib/login-policy.ts`). Without that limit, anyone could log in as any number.
- Security headers: no embedding in other sites, and camera, microphone and location are allowed only for this site (`next.config.ts`).
- The developer gallery (`/dev/components`) doesn't exist on a deployed site.
- **Emergency switches** at `/ops/safety` (admins): pause new tasks, freeze all money movements, caps per task / per customer per day / platform-wide. They work instantly, with no redeploy, and every change is logged.
- **SOS** on every live task: 102 / 103 and an alert to Ops with the phone's position. Turn on notifications for your admin account at **Profile → Operations** on the phone you carry.
- Secrets are only in Vercel's encrypted settings and Supabase Vault (the scheduler secret), never in git.

## Before real users (not done yet)

- [ ] **Real SMS provider** (a Mongolian SMS gateway). Then set `SMS_PROVIDER`, remove `DEV_SHOW_SMS_CODES` and `TEST_PHONES`.
- [ ] **Real payments:** a QPay / partner-bank adapter and verified webhooks; `PAYMENT_PROVIDER` ≠ `mock`.
- [ ] **Call relay:** our own coturn server; set 🔒 `TURN_URLS` and 🔒 `TURN_SECRET`.
- [ ] Your own domain, for example `tuslamj.mn` (Vercel → Domains), then run `scheduler:configure` again with it.
- [ ] Terms of service and a privacy policy (ID documents, location, chat retention).
- [ ] Native review of the Mongolian text.
- [ ] **Someone on duty for SOS** while tasks run (push on, phone charged), plus a written "what to do on an SOS" checklist. Consider an SMS fallback to Ops once the SMS provider exists.
- [ ] Review the caps at `/ops/safety` for the beta size (defaults: 300,000₮ per task, 600,000₮ per customer per day, 5,000,000₮ held in total, 3 active tasks).

## Health check
- `/ops` shows "Background jobs: ✓ running / ⚠️ stopped". Stopped = expiries, auto-release and SOS reminders aren't happening.
- `GET /api/health` → 200 `{ok:true}` while the tick runs, 503 otherwise (no details). Point a free uptime monitor at it after deploy so someone is alerted if it stops.

## Going live with wire.mn (payments)

How money moves now (docs/decisions.md 2026-11-18 "Direct pay + wire.mn"): the customer pays **only our service fee** through wire.mn when choosing a helper, and pays the helper **directly** after the job (bank transfer to the account shown, QPay or cash). The app never holds the helper's money. The fee is refunded automatically if the helper backs out or Ops refunds a dispute; it's kept if the customer cancels after paying.

1. Finish wire.mn's onboarding (request → review → e-contract) and connect the payment operators you want in the wire.mn dashboard.
2. Add to `.env.local` and to Vercel (🔒 = Sensitive):
   | Name | Value |
   |---|---|
   | `PAYMENT_PROVIDER` | `wire` |
   | 🔒 `WIRE_SECRET_KEY` | `sk_live_…` from the wire.mn dashboard |
3. Register the webhook (prints the signing secret once):
   ```bash
   npm run wire:webhook -- https://your-app.vercel.app
   ```
   Add the printed `whsec_…` as 🔒 `WIRE_WEBHOOK_SECRET` in `.env.local` and Vercel, redeploy, then **verify the endpoint** in the wire.mn dashboard.
4. wire.mn has no test mode: make one real small payment yourself (post a task, have a test helper accept, pay the fee), check it shows "Хураамж төлөгдлөө ✓", then cancel via a helper back-out to see the refund arrive.
5. Watch **Ops → Төлбөр** for helpers who weren't paid and refunds wire couldn't finish on its own.

Safety: with `PAYMENT_PROVIDER=wire` and a missing key, paying fails with a message — it never falls back to the simulated button. A payment counts only when wire's signed notification (or our own check with wire) says so; a payment that arrives after the task moved on is refunded in full.
