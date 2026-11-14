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
- Secrets are only in Vercel's encrypted settings and Supabase Vault (the scheduler secret), never in git.

## Before real users (not done yet)

- [ ] **Real SMS provider** (a Mongolian SMS gateway). Then set `SMS_PROVIDER`, remove `DEV_SHOW_SMS_CODES` and `TEST_PHONES`.
- [ ] **Real payments:** a QPay / partner-bank adapter and verified webhooks; `PAYMENT_PROVIDER` ≠ `mock`.
- [ ] **Call relay:** our own coturn server; set 🔒 `TURN_URLS` and 🔒 `TURN_SECRET`.
- [ ] Your own domain, for example `tuslamj.mn` (Vercel → Domains), then run `scheduler:configure` again with it.
- [ ] Terms of service and a privacy policy (ID documents, location, chat retention).
- [ ] Native review of the Mongolian text.
