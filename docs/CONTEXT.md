# Tuslamj Hub — context for an AI assistant

Read this first if you are a model picking up this codebase cold. It explains what the product is, how the code is put together, which rules must never break, what is built, what isn't, and where the weak spots are. Detailed rules live in `docs/*.md`; this file connects them.

_State as of 2026-11-15 (after chat, calls, helper verification and the scheduler). Section 13 covers how code is written here._

_2026-11-21 audit: tracking can be retried, consent changes update the controls immediately,
and online failures are shown instead of silently ignored. Going offline stays available when
device permissions are lost. Scheduler authentication handles malformed credentials safely;
heartbeat and lease-release failures now propagate. Live read-only checks found tracking tables
present, but `/api/health` returned 503 and the last successful tick was November 15 at 00:29
Ulaanbaatar time despite active pg_cron runs. Scheduler repair remains an operational follow-up._

_2026-11-20 tracking repair: worker location now runs in the signed-in layout across navigation,
with periodic samples for stationary helpers and explicit per-job sharing. Customer maps expire
stale coordinates locally and show tracking status. `npm run check:live` verifies the API schema
and scheduler without reading user data. Deployment requirements are in `docs/deploy.md`._

_Specialized-services update (2026-11-19): childcare, eldercare and personal/medical care are excluded from launch; ordinary adult accompaniment is supported only for adults who travel independently. New care posts, matching and care credentials are disabled; existing assigned care bookings keep their original terms. Apply `20261119000000_pause_direct_care.sql` after the earlier migrations. See `docs/decisions.md` “Launch scope for care and accompaniment”; hosted rollout and browser verification remain pending._


---

## 1. The product in one minute

**Tuslamj Hub** ("тусламж" = help) is a mobile-first web app for **Ulaanbaatar, Mongolia**. It is two things on one engine:

1. **Errand marketplace.** A customer posts a small physical task (shopping, carrying furniture, standing in a queue, delivery, small repairs). Nearby verified **helpers** are notified, send requests, the customer **chooses** one, pays, the helper does the job with photo proof, and the customer confirms.
2. **SafePay.** The same "held payment" for buying from strangers (marketplace, Facebook sellers): the buyer's money is held until they confirm the item arrived as described.

**The core promise is trust:** money is **held by a partner bank**, not by us and not by the helper, and released only when the customer confirms (or automatically after a check window, or by an Ops decision in a dispute).

**Market facts that shaped the design:**
- Payments in Mongolia go through **QPay** (bank-app QR/deeplinks). People don't keep cards on file, so "charge at the end" isn't safe for helpers.
- Addresses are landmark-based ("3-р хороо, 12-р байр, орц 2"), so the map pin matters more than text search.
- **UBCab** (a local ride-hailing app) is the mental model users already know.

**Inspirations researched:**
- Haejuseyo (해주세요, Korea): helpers apply, the customer accepts, escrow-style prepayment, ID-verified helpers.
- TaskRabbit: photo proof before invoicing.
- inDrive / UBCab: dispatch and choosing.

**Languages:** Mongolian is the default UI language, English is secondary. **Money:** integer tögrög, shown as `46,000₮`.

---

## 2. The non-negotiables

Never break these. They are also enforced by tests and database checks.

- **Money is integer tögrög, computed only by the engine** (`src/lib/engine`). The UI never does money math on its own; it calls engine functions (`quoteFee`, `errandSplit`, `heldItemBudget`, `amountDue`).
- **Deal status changes only through engine commands.** Payment is confirmed only by the **payment provider's webhook** (actor `provider`), never by a user or a screenshot. Webhooks are idempotent (same `providerRef` → no-op).
- **Invariant on every release:** `helperNet + refund + platform == held`. The sum of all held deals equals the bank hold balance (double-entry ledger).
- **We never hold funds.** All money movement goes through the `PaymentProvider` interface (`src/lib/payments/provider.ts`). Only the mock exists today.
- **Every transition writes a timeline event,** plus ledger entries if money moved. Illegal transitions are rejected (engine and a DB trigger).
- **Phone numbers are never shown** to the other party. Chat and calls stay inside the app.
- **All user-facing strings go through i18n** (`src/i18n/mn.ts` and `en.ts`).
- **Private-test login:** without real SMS, phone OTP is limited to `TEST_PHONES` (`lib/login-policy.ts`). Verify.MN optionally verifies a delivery recipient through a private, shareable link; the recipient sends the MO SMS themselves. It is not login, OAuth or ДАН.
- **Secrets live only in `.env.local`** (git-ignored). Never in code, never in git. Verified on 2026-11-13: nothing has ever leaked into history or the client bundle.
- **Database changes only as migrations** in `supabase/migrations/`. Never use the dashboard's "autofix".

---

## 3. Stack and how to run it

- **Next.js 16.4.6** (App Router), **React 19.3**, **TypeScript**, **Tailwind 4** (`@theme` tokens in `src/app/globals.css`).
  - ⚠️ Next 16 differs from older versions; see **Appendix 0** (cheat sheet) and `AGENTS.md`.
    - `src/proxy.ts` replaces middleware.
    - `params` and `searchParams` are Promises.
    - `PageProps<"/route">` is a global type (regenerate with `npx next typegen`).
    - Use `refresh()` from `next/cache` in server actions.
    - `error.tsx` receives `retry`.
  - Read `node_modules/next/dist/docs/` before using an API you're unsure of.
- **Supabase:** Postgres, Auth (phone OTP), RLS, CLI 3.1. The hosted project is linked.
  - `@supabase/ssr` for cookies; `getClaims()` for auth.
  - The service-role ("secret key") admin client is for server code only.
- **Tests:** **Vitest**. The database tests run the real migrations in **PGlite** (Postgres compiled to WASM, in-process), with stubs for Supabase's `auth` schema and roles (`src/lib/db/__tests__/pg.ts`). **221 tests** cover the engine, money, transitions, simulation, the DB round-trip, RLS, dispatch and maps.
- **Other libraries:**
  - `maplibre-gl` (open-source maps on OpenFreeMap tiles)
  - `web-push` (VAPID Web Push)
  - `tsx` (scripts)

| Command | What |
|---|---|
| `npm run dev` | dev server on :3000 |
| `npm test` | all tests (engine + PGlite DB) |
| `npm run typecheck` / `npm run build` | must stay clean |
| `npx supabase db push --remote` | apply migrations to hosted DB (in agent mode it needs `--yes` **and the owner's explicit OK each time**) |
| `FUZZ_SEEDS=20000 SIM_SEEDS=200 npm test` | deep random walks (money, bargaining, direct requests) — before a release |
| `E2E_ENV_FILE=… E2E_CONFIRM_PROJECT=<ref> npm run e2e` | browser tests (`e2e/`, Playwright + installed Chrome) against a real project; needs `npm run build` + seed; refuses to run unless the ref is named — meant for **staging** |
| `npm run seed` | seed demo users (`scripts/seed.ts`) |
| `npm run cron:local` | dev scheduler: ticks the local app every 20 s |
| `npm run check:deploy` | pre-deploy settings check (names only, never values) |
| `npm run scheduler:configure -- https://<domain>` | production scheduler setup (URL + Vault secret); `-- --status` to inspect |

**Env variables** (names only; values are in `.env.local`):
- **Server-only secrets:** `SUPABASE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.
- **Public by design** (end up in the browser): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- **Other:** `VAPID_SUBJECT`, `DEV_SHOW_SMS_CODES`, `PAYMENT_PROVIDER` (default `mock`), `TEST_PHONES` (on a deployment without real SMS, only these numbers can sign in; `lib/login-policy.ts`), `SMS_PROVIDER` (empty until real SMS).
- **Relay (before launch):** `TURN_URLS`, `TURN_SECRET` (server-only), for our own coturn server.
- **Optional later:** `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Google tiles and search) and a vision-model API key (AI proof checks). The owner prefers **no new third-party keys**, so choose key-free or open-source designs first.

**Demo accounts** (seed): customer Solongo `97688000001`; approved helpers Bat-Erdene `97688000011` (all categories) and Nomin `97688000012`. Login is a phone OTP. In dev, the code is shown on screen, because the Supabase "Send SMS hook" writes it to a private outbox instead of sending an SMS.

---

## 4. Architecture

```
Browser (React client components: forms, sheets, maps, push toggle, geolocation)
   │  server actions / page renders
   ▼
Next.js server (src/app/**/actions.ts, page.tsx)  ── auth: getViewer() (src/lib/auth.ts)
   │
   ├─ src/lib/engine/   PURE deal engine: no I/O, no clock. apply(deal, cmd, ctx) → Transition
   ├─ src/lib/db/       mapping.ts (row ⇄ engine object), deals.ts (loadDeal / insertDeal / runCommand)
   ├─ src/lib/deals/    queries.ts (read models for screens; lazily "settles" due commands)
   ├─ src/lib/dispatch/ plan.ts (pure ranking/waves) · run.ts (waves, auto-pick) · rank.ts (applicants, limits)
   ├─ src/lib/push.ts   Web Push fan-out (per-device language)
   └─ src/lib/payments/ PaymentProvider (mock only)
   ▼
Supabase Postgres: RLS (clients read only, own rows) · all writes via service role
   apply_transition() RPC = one transaction: deal row + offers + dispute + events + ledger + penalties,
   optimistic lock on deals.version (PT409 on conflict), re-checks hold balance == held_amount.
```

### The write path (most important pattern)

`runCommand(db, dealId, cmd, actor)` in `src/lib/db/deals.ts`:
1. Load the deal (row + offers + dispute) and map it to an engine object.
2. `apply(deal, cmd, { now, actor })`. The engine validates who may act and whether the transition is legal, then returns the new deal plus events, ledger entries and effects.
3. `applyTransitionArgs(before, transition)` builds the RPC payload (new or removed offers, dispute upsert, events, ledger, suspensions).
4. The `apply_transition()` RPC writes everything atomically. **Never write `deals`, `ledger_entries` or `timeline_events` any other way.** `insertDeal()` is the only way to create a deal.

### The engine (`src/lib/engine/`)

- `types.ts`: `ErrandDeal`, `GoodsDeal`, `Command` union, `Actor` (`user` with role customer/helper/admin, `provider`, `system`), `ErrandDetails` (jsonb), `TopUp`, `Offer` (with optional `price`).
- `deal.ts`: `createErrand`, `createGoods`, `apply()`, `liveOffers`, `autoPickAt`.
- `money.ts`: `quoteFee` (system price), `errandSplit` (release split), `heldItemBudget`, `minFeeAt` (night minimum), `suggestFee`.
- `ledger.ts`: accounts `ext:<user>` (their bank), `hold` (partner bank hold), `payable:<user>` (released, awaiting withdrawal), `platform`; `checkInvariants`.
- `schedule.ts`: `dueCommand` / `runDue` (expiry, payment lapse, auto-release).
- `config.ts`: all numbers (pricing defaults; live values come from `pricing_settings` via `lib/pricing.ts`).
  - Pricing: build-up `quoteFee` (base 5,000 ≈ 30 min/1 km; +3,000 per 30 min, +1,500/km, heavy +3,000, stairs +1,500/floor, tools +2,000, night +1,000, 2nd person = labour again). The customer can set −20%…+30%; a helper's counter is ≤ +30%. Helpers keep 100%; the customer pays a flat service fee (500–3,000 by price step). Cancel fee 3,000.
  - Time windows: 24 h check window; 30 min no-helper deadline; 10 min to pay; instant requests lapse after 15 min; auto-pick after 3 min.
- Fee terms are **snapshotted** onto each deal at creation.

---

## 5. The errand lifecycle (current)

```
post (free; system price; optional map pin; optional "Choose for me")
  → open ── helpers notified in waves; helpers `apply` ("Хийж чадна"; Custom tasks may quote a price)
     │        customer `choose`s one   (or system auto-picks the best applicant 3 min after the first request)
     │        [legacy: `accept` = first-to-accept still exists in the engine, not offered in the UI]
     ▼
  awaiting_payment ── customer pays within 10 min via provider (mock button today)
     │   ├─ not paid in time → back to open (helper released, chosen offer dropped, fee reset to postedFee)
     │   │                      or expired if the match deadline also passed
     │   └─ helper may withdraw here without penalty → back to open
     ▼
  matched (money HELD) ── customer cancel = 3,000₮ to the helper, rest refunded; helper cancel = full refund + 3-day suspension
     ▼  helper `start`
  in_progress ── `record_receipt` (if buying items), `record_handover` (photo proof)
     │   receipt > budget → topUp pending → customer approves (2nd held payment via provider) or declines (items returned)
     ▼  helper `finish` (needs handover proof, plus a receipt if there is an item budget)
  check (24 h) ── customer `confirm` → released │ `dispute` → disputed → Ops `resolve` (release | refund)
     ▼  no action in 24 h → system `auto_release`
  released  → split: helper gets fee − 10% + items spent; customer gets unspent budget back; platform gets service fee + commission
```

**No helper by `matchBy`** (30 min for "now"; otherwise the scheduled time) → `expired`, and nothing is charged.

**SafePay (goods):** seller creates the deal and gets a 6-character code → buyer `claim`s → pays (provider) → `held` → seller `handover` → `check` (24 or 72 h) → confirm / dispute / auto-release. The buyer fee is 1% (min 1,000).

**Customer extras (all engine rules):**
- Buy-for-me item budget, with an optional +10% buffer.
- Over-budget top-up.
- Round trip.
- Carry rules: heavy item, no lift, above floor 2 → 2 people required.
- Saved addresses (Гэр / Ажил / Бусад, with a pin).
- "Дахин захиалах" (repeat a finished task, price recalculated).

---

## 6. Matching and dispatch (UBCab-style)

- **Presence:** helpers go online with a radius (1/3/5/10 km, district ≈ 15, city 60). While online, the browser sends its position about once a minute. It's stale after 10 minutes (`helper_presence`).
- **Waves** (`WAVES` in `plan.ts`):
  1. Up to 5 best within 2 km, 45 s.
  2. Up to 10 within 5 km, 45 s.
  3. Up to 25 within 10 km, 60 s.
  4. Everyone left, city-wide.
  - An empty wave widens immediately.
  - Waves stop once the task has 5 live applicants.
  - A helper is only reached within their own radius, and never twice for the same task.
- **Score:** 55% distance + 25% Bayesian rating (prior 4.5★ × 5) + 10% reliability (offers won / received, 30 days) + 10% experience. The same score ranks applicants for the customer; the best one is badged "Санал болгосон".
- **Limits:**
  - A helper can have at most 3 open requests.
  - Instant requests lapse after 15 min.
  - When a helper is paid for one task, `releaseOtherCommitments` withdraws their other requests and steps them back from other unpaid matches.
- **Triggers** (all idempotent):
  - right after posting;
  - the customer's task screen polls every 10 s (`pokeTask`);
  - `GET /api/cron/tick` (Bearer `CRON_SECRET`; also settles due expiries and auto-releases), called every 20 s by Supabase pg_cron once the app has a public URL (`npm run scheduler:configure`), or by `npm run cron:local` in dev. A DB lease prevents overlap; `system_heartbeats` shows the last run.
- **SQL:** `dispatch_candidates()` and `nearby_open_deals()` compute haversine distance in plain SQL (PostGIS could replace them).
- **Feeds for helpers:**
  - **Ойролцоо:** offers to me, my requests, nearby within radius.
  - **Бүх ажил:** every open post city-wide, any category, sortable nearest / newest / best paid. Taking a task still needs an approved helper in that category.
- **Matched posts leave every feed.**

---

## 7. Maps, location, push

- **In-app maps:** MapLibre plus OpenFreeMap tiles (no key).
  - `PinMap` (ride-app style: the pin stays fixed and the map moves under it) is used when posting.
  - `TaskMap` (read-only markers) is used on Home, the customer's task screen, the helper's Jobs tab and job screen.
- **Directions:** a hand-off to **Google Maps' own app** via public Maps URLs (`src/lib/maps.ts`, no key); the pickup becomes a waypoint.
- **Privacy:**
  - Before a helper is matched they see only a **~300 m area** (`fuzz`), no street address and no entrance/floor/door.
  - After payment they see the exact pin, address, details and a directions button. Applicants still see an approximate area while payment is pending.
  - A helper may explicitly share their live position with that task's customer while work is in progress. It updates about every 30 s while the job page is visible and stops on opt-out or when the job leaves `in_progress`; it is not automatically shared just because a helper was matched.
- **Push:** VAPID Web Push (`public/sw.js`, `push_subscriptions` with a per-device locale). It notifies helpers of new nearby tasks, and covers chosen, paid, new applicant, helper accepted and auto-chosen events.
- **Pickup pin (2026-11-16):** shop / deliver / carry pin both pickup and drop-off (Pickup / Drop-off switch over the `PinMap`). With both pins the engine measures the trip (`roadKm`: straight line × 1.3) for the price; without a pickup pin the customer picks a rough km. Dispatch and feeds measure "nearby" from `helperStart` (pickup ?? task pin).
- **Planned / optional:** address search and address-from-pin (third party: ask the owner first); Google tiles, Places and Routes ETA only if the owner adds a key, with MapLibre as the fallback.

---

## 8. Data model (Supabase)

Migrations, in order:
1. `init`: enums, profiles, deals, offers, disputes, proofs, ratings, ledger (append-only), timeline, `insert_deal` / `apply_transition`, `deal_status_allowed` trigger, RLS.
2. `tighten_profile_access`: phone, ДАН name and payout are server-only columns; helpers moved to the `private` schema (**use `private.is_admin()` / `private.is_participant()`**).
3. `send_sms_hook`: mock OTP.
4. `ui_flows_rules`: pickup address, `pay_by`, `rate_deal`.
5. `task_details`: `details` jsonb.
6. `saved_addresses_topup`: `saved_addresses` (owner-only RLS) and `top_up`.
7. `dispatch`: `posted_fee`, `offers.price`, new transitions, `apply_transition` v3 (writes fee / `pay_by`, deletes removed offers), `helper_presence`, `dispatch_offers`, `dispatch_state`, `push_subscriptions`, pins on saved addresses, the dispatch SQL functions.
8. `proofs`: the private `proofs` storage bucket, plus `mime`, `bytes`, `sha256`, `dhash`, `flags` and `ai` on `proofs`.
9. `chat`: `messages.helper_id` (one conversation per task and helper), `image_path`, `flags`, `seen_at`; own-conversation RLS (Ops only when disputed); the private `chat` bucket; the Realtime publication.
10. `calls`: `call_signals` (RLS: the two people on the call), `messages.audio_path` / `audio_seconds`, audio types in the chat bucket, Realtime.
11. `helper_kyc`: `helper_applications` and `payout_accounts` (server-only, no client grants), the private `kyc` bucket.
12. `scheduler`: pg_cron job `tuslamj-tick` (20 s), `private.cron_tick()` (pg_net + Vault secret), `configure_scheduler` / `scheduler_status`, `try_lease` / `release_lease`, `system_heartbeats`.
13. `safety`: `platform_controls` (pause switches, caps), `payin_check()`, the ledger freeze and posting-pause triggers, `incidents` (SOS / reports), `ops_audit_log` (append-only).
14. `pricing`: `pricing_settings` (the live price list Ops edits).
15. `pickup_pin`: `deals.pickup_lat/lng` (both or neither); `dispatch_candidates` and `nearby_open_deals` measure from the pickup when pinned.
16. `private_task_pins`: the deals select policy is participants or admin only (no helper-feed / applicant clause).
17. `saved_helpers`: customers' ♡ list (own-list RLS, writes server-only).
18. `bargaining`: `offers.proposed_by`, `deals.price_change`; `apply_transition` v4 (also writes `posted_fee`, `price_change`, offers' `proposed_by`).
19. `listings_direct_requests`: `profiles.bio` / `from_price` (public read); `deals.invited_helper_id` / `invite_until` / `invite_open_after` + `private.check_invite` trigger; `deals.provider_refs` (every booked payment ref, replay-safe); `apply_transition` v5; `nearby_open_deals` hides others' direct requests; `quick_starts` and `category_keywords` (server-only, Ops edits at /ops/content).

**RLS model:**
- Clients (`authenticated`) only **read**, and only their own rows or rows they participate in. Deals: customer, matched helper, seller/buyer, Ops — helpers can't read open tasks through the API (2026-11-16); feeds are server-rendered with the ~300 m fuzz.
- Every write goes through server code using the service role, after the server has checked the user (and, for money and status, after the engine has).
- Exceptions: users may update their own name and area, and write their own `saved_addresses`.

---

## 9. UI and conventions

- **Layout:**
  - `(app)/(tabs)`: customers have one screen, Home (active tasks, money card, past tasks with "Order again"), and no tab bar. Helpers have a floating 2-tab bar: Ажил · Орлого. There are no History or Wallet pages (decisions 2026-11-15 "Fewer screens").
  - Flows (post, task, job, profile) use ✕/← headers and a sticky primary bar.
  - Mode (customer/helper) is a cookie; the proxy redirects helper-mode `/` to `/jobs`.
- **Design tokens and components:** `src/components/ui.tsx`, `sheet.tsx` (bottom sheets, `ConfirmSheet`, `SubmitButton`), `choice.tsx`, `deal-card.tsx`, `step-tracker.tsx`, `offer-card.tsx`, `inline-action.tsx`, `auto-refresh.tsx` (polling until Realtime).
- **Gallery:** `/dev/components`, including every deal state from engine-built fixtures (`?state=open_now`, `topup_pending`, …).
- **i18n:** `t("key", params)`; `getT()` on the server, `useT()` on the client; keys are typed, so a missing key is a compile error.
- **Docs map:**
  - `docs/rules.md`: money, states, dispatch ("As implemented" is the truth).
  - `docs/ui.md`, `docs/screens-*.md`: screens.
  - `docs/copy.md`: tone.
  - `docs/decisions.md`: why, plus open questions.
  - `archive/`: long originals; don't read unless asked.

---

## 10. Status

**Built and tested:**
- Auth (mock OTP).
- Engine and ledger.
- Full customer flow: post → match → pay held → progress → check → confirm/dispute → rate.
- Over-budget top-up, saved addresses, repeat task.
- Helper online/radius, wave dispatch, Web Push, nearby and all-tasks feeds, apply/quote/withdraw/start.
- Customer chooses with "Choose for me".
- Maps on both sides, live helper position, Google Maps directions.
- **Photo/video proof:** receipt photo with its total, handover photo or video, a private bucket with signed upload and read links, sha256 + perceptual-hash reuse flags, then "Дууслаа" → check. The helper's earnings list shows finished jobs.
- **Chat:** one conversation per task and helper, Realtime with a polling fallback, photos, contact masking, rate limit, seen marks, push without content, 90-day retention (`/chat/[id]`, `lib/chat.ts`, `lib/chat-rules.ts`).
- **Helper verification:** `/helper/apply` asks for ID front/back, a selfie with ID, and a same-name payout account. Ops manually reviews identity and payout details; ID images and birth date are deleted 30 days after the decision. Criminal-record certificates are not collected or shown as a badge. Legacy level-4 data and old task requirements remain for historical compatibility (`lib/kyc.ts`, `lib/kyc-rules.ts`).
- **Calls and voice messages:** WebRTC calls are off unless `CALLS_ENABLED=true` and a TURN relay is configured; they fail closed instead of falling back to direct connections. Text chat and voice messages remain available. Calls are not recorded; signals are deleted after 1 h.
- **Pricing:**
  - Build-up recommended price with each extra shown; the customer adjusts −20%…+30% (green/orange hint).
  - Helpers accept or counter once (≤ +30%, never lower).
  - Helpers keep 100%; there's a flat service fee.
  - Live settings at `/ops/pricing` with worked examples (`lib/pricing.ts`, `lib/pricing-rules.ts`).
- **Safety controls and SOS:**
  - Ops hub `/ops`.
  - `/ops/safety`: pause new tasks, freeze money movements, caps per task / per customer per day / platform-wide / active tasks. These are enforced by DB triggers and `payin_check()` before invoices. The page also shows the audit log.
  - SOS on task and job screens: 102 / 103 plus an alert to Ops with position, re-pinged until acknowledged; the other person is not told.
  - "Report a problem", reviewed in `/ops/incidents` (`lib/safety.ts`, `lib/incidents.ts`, `lib/incident-rules.ts`).
- Home's money card and the helper's earnings read from the ledger.
- Dev gallery.

**Not built yet** (rough priority):
1. **TURN relay before enabling calls:** configure Cloudflare TURN or a coturn relay, then set `CALLS_ENABLED=true`. Calls are relay-only and fail closed if relay setup fails.
2. **AI proof checks (deferred, optional):** read receipt totals and judge "does this show the job done?". The owner doesn't want new keys, so options are a hosted vision API later, or open-source models (PaddleOCR, an open vision model) on our own server. Results go in `proofs.ai` as flags only; Ops decides.
3. **Two-way ratings** (helpers rate customers; each side's rating hidden until both submit).
4. **SafePay screens** (the engine exists).
5. **Ops panel:** disputes, helper approval/KYC (ДАН), payouts.
6. **Deploy on Vercel** following `docs/deploy.md` (prepared: Seoul region, `TEST_PHONES` login lock, security headers, manifest and icons, `npm run check:deploy`), then `npm run scheduler:configure -- https://<domain>`.
7. **Real QPay / bank adapters** behind `PaymentProvider`, with webhook verification.
8. **Supabase Realtime** to replace polling.
9. **Multi-person jobs** ("keep recruiting", split payouts).
10. **Address search / address from pin** (pickup pin and measured distance: done 2026-11-16).
11. **Google Maps tiles, Places and Routes** once the owner adds a key.
12. **Native review of the Mongolian copy.**
13. **From the reference review** (`docs/decisions.md`, 2026-11-14):
    - customer limits (active tasks: done; unpaid balance: not yet);
    - cancellation reasons;
    - tips;
    - "N helpers nearby" on Home;
    - route-based distance (OSRM/Valhalla);
    - a Capacitor native wrapper.

---

## 11. Things worth pondering (known weak spots and open questions)

- **Dispatch races:** two concurrent `runDispatch` calls can send a wave early. Duplicate offers are blocked by the primary key, but the wave/state upsert isn't compare-and-swap. A `dispatch_state` version or row lock would fix it.
- **Cross-deal invariants live in app code, not the DB:** the 3-open-requests limit and `releaseOtherCommitments` are server-side best effort (errors swallowed per deal). A helper could still end up matched and paid on two tasks if two payments land at once. Options: a DB constraint or advisory lock per helper, or a "busy" flag checked in `apply`.
- **Payment lapse versus a late webhook:** if the bank confirms after a match lapsed, `confirm_payment` throws. The provider adapter must then refund. That path is documented but not implemented, because the mock can't produce it.
- **Web geolocation limits:** background tracking stops when the screen locks. Reliable live tracking and push on iOS need a PWA install or a native app.
- Private Vercel testing can skip helper ID and payout-bank collection with `UNVERIFIED_HELPERS_TEST_MODE=true`; any verified Mongolian phone can opt into helper work. Never use this mode for public launch.
- **Privacy:**
  - The 300 m fuzz is a fixed grid, so repeated tasks from one home always land in the same cell; jitter per deal may be better.
  - The pickup address text is shown pre-match (fine for stores, not for homes). The pickup pin is fuzzed pre-match like the task pin.
  - `helper_presence` holds precise live locations. Retention and deletion policy are undecided.
- **Trust and safety:**
  - Helper verification is a manual Ops review (no ДАН integration or automatic face match yet).
  - SOS reaches Ops by push only (no SMS or phone fallback), and nobody is on duty yet.
  - Rate limits exist for chat, calls and reports, not for every action. Dispute evidence (proof photos, chat logs, call recordings) isn't stored yet.
- **Unit economics:** service fee and commission are demo numbers; partner-bank and QPay fees aren't modeled.
- **Legacy data:** deals paid at posting (the old flow) still work through special branches (`assignHelper` with `heldAmount > 0`, refunds on cancel/expire). They can be removed once no such deals exist.
- **Testing gaps:** browser tests (`e2e/`) now cover bargaining, direct requests, helper listings and Ops content; maps, push, geolocation, calls and real phones are still checked by hand.
- **No staging yet:** the only hosted project is production. Plan (2026-11-16): a second free Supabase project `tuslamj-staging` (owner creates it), `.env.staging.local` (git-ignored), migrations + seed there first, `npm run e2e` against it, then production.

---

## 12. Working with the owner

- The owner **commits and pushes themselves**. End a work session with test and build status plus the exact `git` commands. Don't commit for them.
- They decide quickly when given **concrete options with a recommendation** (they usually take the recommended one).
- Ask before anything outward-facing: hosted `db push`, deleting data, sending to external services.
- **Keys:** never ask them to paste keys into the chat. They put them in `.env.local`. They **prefer not to sign up for new services or keys**, so propose key-free or open-source options first and keep paid APIs optional.
- **Language:** they write in English; the app is Mongolian-first.

---

## 13. How code is written here (conventions)

There's no ESLint or Prettier config: **match the surrounding code.** That means 2-space indent, double quotes, semicolons, trailing commas, lines up to about 140 characters, and named exports (default exports only where Next requires them: pages, layouts, routes). TypeScript is `strict`. Import from `@/…` (= `src/…`). The **React Compiler is on** (`reactCompiler: true`), so don't add `useMemo` or `useCallback` for performance.

### Shape of the code
- **Pure logic is separate from I/O.**
  - Business rules live in pure, tested modules: `lib/engine/*`, `lib/dispatch/plan.ts`, `lib/maps.ts`, `lib/proof-hash.ts`.
  - Anything that talks to Supabase, push or storage starts with `import "server-only"`.
- **One source of truth per concern:**
  - money and status → engine;
  - row ⇄ object → `db/mapping.ts`;
  - screen reads → `deals/queries.ts`;
  - text → `i18n`;
  - numbers → `engine/config.ts`.
- **Naming:**
  - Engine command and event codes are `snake_case` (they match DB and timeline codes).
  - TypeScript is `camelCase`; DB columns are `snake_case`. Conversion happens only in `mapping.ts`.
  - Files are `kebab-case`.
- **Money:** integer tögrög only (`assertMoney`). Never floats. Display with `fmtMoney` (`46,000₮`). Percentages are basis points (`bps`).
- **Time:**
  - The engine takes `ctx.now` (epoch ms) and never reads the clock.
  - The DB stores ISO `timestamptz`.
  - Ulaanbaatar wall time (UTC+8) only goes through `lib/format.ts`.
- **Comments:**
  - JSDoc on exported functions explaining *why*, often linking the rule (`docs/rules.md §Dispatch`, `docs/decisions.md 2026-11-13`).
  - No commented-out code, and no comments that just restate the code.
- **Errors:**
  - The engine throws `EngineError(code, message)`.
  - Server actions catch it and return a **localized** `{ error }` (via `t()`). Unknown errors are rethrown and reach `error.tsx`.
  - Storage failures are `DbError`.
  - Form actions return `ActionResult` (`{ error?: string; done?: true }`).

### Server versus client
- **Pages are async server components** that call `getViewer()`, then read through `deals/queries.ts`. Those reads use the admin client, but only after an explicit permission check (`canView`, `getJobForHelper`, …). **Client components never query Supabase.** The one exception is uploading a proof file to a server-issued signed URL.
- **Mutations are server actions** in a route-local `actions.ts`. Usually one action per screen takes an `intent` field (`taskAction`, `jobAction`).
  - Every action calls `getViewer()` first, then validates all input on the server: UUID regex, integers, enums, lengths. The client only guides.
  - It then calls `runCommand(...)` with the viewer's actor, so the engine checks the role and ownership again.
  - After the write it calls `refresh()` or `redirect()`.
- **Client components** (`"use client"`) exist only for interaction: sheets, maps, geolocation, camera, polling. They receive data and server actions as props, or import actions from an `actions.ts`.
- **Prefer things that work without JavaScript:** filters are `<Link>`s with query strings, and forms post hidden inputs.

### Database changes
- **Never edit an applied migration.** Add `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`.
- **Every new table:**
  1. `enable row level security`;
  2. `revoke all … from anon, authenticated`, then grant only what's needed (usually `select`);
  3. policies using `private.is_admin()` / `private.is_participant(deal_id)`;
  4. `check` constraints for shape, plus indexes for the queries you'll run.
- **Functions:**
  - `set search_path = ''` with fully qualified names.
  - `revoke execute … from public`, then `grant execute … to service_role`.
  - `SECURITY DEFINER` only in the `private` schema.
- **Changing `apply_transition` or `insert_deal`:** copy the whole current function into the new migration (`drop` + `create` if the signature changes), then update `mapping.ts` and the tests.
- **Test every migration in PGlite** (`schema.test.ts`): a round-trip (DB equals engine), RLS for each role, constraints. If a migration touches a Supabase schema such as `auth` or `storage`, add a minimal stub in `__tests__/pg.ts`.
- Applying a migration to the hosted DB needs the owner's OK each time.

### Recipe: a new engine rule or command
1. Add types in `engine/types.ts` (+ `DEFAULT_DETAILS` if it's a detail flag) and numbers in `engine/config.ts`.
2. Add a `case` in `apply()`:
   - guards (`requireStatus`, `requireUser` / `requirePayer` / `requireAssignedHelper` / `requireKind`);
   - mutate `tx.d`, emit `tx.ev(code, data)`;
   - move money **only** with `tx.payIn` / `tx.fromHold`.
3. Engine tests use the `World` helper (`post`, `pay`, `do`, `reject`, `tick`, `advance`, `bal`, `codes`; it runs `checkInvariants` after every step). Also update the table in `transitions.test.ts`.
4. If something new is stored: update `mapping.ts`, add a migration, and if there's a new status pair, update `deal_status_allowed`.
5. Show it: `labels.ts` `describeEvent`, plus `event.<code>` in both language files.
6. Document it under "As implemented" in `docs/rules.md`, and in `docs/decisions.md` if a product choice was made.

### UI rules
- **Mobile first:** `max-w-lg`, a 20 px gutter (`px-5`), touch targets ≥ 44 px (`min-h-11` / `12` / `14`).
- **Use the design tokens and components:**
  - tokens `ink`, `ink-2`, `ink-3` (placeholders only), `held`, `warn`, `danger`, `fill`, `line`, `brand`;
  - radii `rounded-card` / `input` / `cta` / `sheet`;
  - components `btn.*`, `Card`, `Note`, `ConfirmSheet`, `InlineAction`, `ToggleRow`, `chipClass`.
  - Don't hand-roll buttons or colors.
- **One primary action per screen** in `PrimaryBar`. Destructive or money actions go behind a `ConfirmSheet` that states the consequence in plain words.
- **Status is one plain sentence** (`deal.line.*`) plus a badge. Tones come from `labels.ts`.
- **Accessibility:**
  - Chip groups are `role="radiogroup"` / `role="radio"` with `aria-checked`.
  - Live lists use `aria-live="polite"`.
  - Inputs have labels, errors use `role="alert"`, decorative emoji is `aria-hidden`.
- **i18n:** every visible string, including placeholders and aria labels, goes into `en.ts` (which defines the typed shape) **and** `mn.ts`. Amounts and names are passed as params, never concatenated. Mongolian is the default. Mongolian copy is a draft until a native review.
- **New deal state:** add a fixture in `dev/components/fixtures.ts` so it shows in the gallery.

### Definition of done
1. `npm test`, `npm run typecheck` and `npm run build` are all clean (GitHub CI runs the same three on every push).
2. New pure logic has unit tests; new DB objects have PGlite tests; new commands have engine tests and an updated transition table.
3. **Verify against the real hosted DB:**
   - run `next start -p 3123` (never touch the owner's dev server on :3000);
   - sign in seed users through the real OTP flow (`dev_latest_sms_code`);
   - `curl` the pages and check for the expected Mongolian strings;
   - drive the backend with throwaway scripts (`npx tsx --conditions=react-server --tsconfig tsconfig.json <script>`, kept outside the repo);
   - **clean up test data afterwards** (cancel test tasks, turn test helpers offline).
4. Report honestly what wasn't verified (real browser or phone interactions such as the camera, maps and push).
5. Update the docs: `rules.md` "As implemented", `decisions.md`, and the status in this file.
6. End with the exact `git` commands for the owner.

**Shell notes (macOS zsh):**
- There's no `timeout` command.
- An unquoted `$VAR` holding a command doesn't word-split; use a shell function.
- `sed -i ''` is the BSD form.
- Load env with `set -a; . ./.env.local; set +a` and never print secret values.

---

# Appendix 0 — Next.js 16 cheat sheet (read before writing any Next code)

This project uses **Next.js 16.4.6 + React 19.3**, which is newer than most models' training data. `AGENTS.md` (auto-written by `next dev`) only says "read `node_modules/next/dist/docs/`". These are the differences this codebase relies on, checked against those bundled docs:

- **`middleware.ts` is deprecated → `proxy.ts`** (`src/proxy.ts` exports `proxy` and calls `updateSession`). Don't create a middleware file.
- **`params` and `searchParams` are Promises.** Always `await` them:
  ```tsx
  export default async function Page({ params, searchParams }: PageProps<"/tasks/[id]">) {
    const { id } = await params;
    const sp = await searchParams;
  }
  ```
- **`PageProps<"/route">` and `LayoutProps<"/route">` are global types**, generated by `next dev`, `next build` or **`npx next typegen`**. Run typegen after adding a route, or `tsc` complains.
- **Server actions:** a `"use server"` file must export **only async functions** (no constants or helpers; put those in a separate `server-only` module). After a mutation call **`refresh()` from `next/cache`** to re-render the current page. Use `redirect()` from `next/navigation` to leave.
- **Forms:** React 19 `useActionState(action, initial)` + `useFormStatus()` for pending state. Uncontrolled forms **reset after an action**, so echo typed values back or keep them in state.
- **`error.tsx`** receives `{ error, retry }` (not `reset`).
- **Route handlers** (`app/**/route.ts`) use Web `Request`/`Response`. They aren't cached by default, and can't sit at the same segment as a `page.tsx`.
- **Client vs server:** pass only serializable props (no functions) from server to client components. Server actions *can* be passed, including `.bind(null, id)`. Browser-only libraries (`maplibre-gl`, geolocation, `crypto.subtle`) are dynamically imported or used inside `useEffect`.
- **`NEXT_PUBLIC_*` env vars** must be read with literal `process.env.NEXT_PUBLIC_X` access so Next can inline them (`src/lib/supabase/env.ts`).
- Tailwind 4: tokens live in `@theme` in `src/app/globals.css`; there is no `tailwind.config.js`.
- When unsure about any other API, check `node_modules/next/dist/docs/01-app/` (getting-started and api-reference) rather than memory.

---

# Appendix A — Engine commands (the whole state machine)

`apply(deal, cmd, { now, actor })` in `src/lib/engine/deal.ts`. Anything not listed here is rejected (`ILLEGAL_TRANSITION` / `FORBIDDEN`), and `transitions.test.ts` checks this for every status.

| Command | Who | From → to (errand unless noted) | Notes |
|---|---|---|---|
| `confirm_payment {providerRef, amount}` | provider | `awaiting_payment → matched` · goods `awaiting_payment → held` | amount must equal `amountDue`; replaying the same ref is a no-op |
| `claim` | any user except the seller | goods `awaiting_payment` (sets buyer) | |
| `apply {note, price?}` | approved helper in the category | `open` (stays open) | max 5 live; instant requests lapse after 15 min; `price` only on Custom (≥ 5,000) |
| `choose {helperId}` | customer; or **system** if `details.autoPick` and 3 min have passed since the first live request | `open → awaiting_payment` | `fee = offer.price ?? postedFee`; `payBy = now + 10 min` |
| `accept` | eligible helper | `open → awaiting_payment` (legacy prepaid → `matched`) | first-to-accept; kept in the engine, not offered in the UI |
| `withdraw_offer {helperId?}` | that helper, or system | `open` | |
| `cancel` | customer | `open` / `awaiting_payment` → `cancelled` (free); `matched → cancelled` (3,000₮ to the helper, rest refunded) | |
| `cancel` | assigned helper | `awaiting_payment → open` (no penalty); `matched` / `in_progress` → `cancelled` (full refund + 3-day suspension effect) | |
| `cancel` | seller | goods `awaiting_payment` / `held` → `cancelled` (refund) | |
| `expire` | system | `open` past `matchBy` → `expired`; `awaiting_payment` past `payBy` → `open` (or `expired` if past `matchBy`) | `schedule.ts dueCommand` decides when |
| `start` | assigned helper | `matched → in_progress` | |
| `record_receipt {amount}` | assigned helper | `in_progress` | only with an item budget; over budget → `topUp = pending` |
| `confirm_topup {providerRef, amount}` | provider | `in_progress` | the 2nd held payment; raises `itemBudget` |
| `decline_topup` | customer | `in_progress` | clears the receipt; items are returned |
| `record_handover` | assigned helper | `in_progress` | |
| `finish` | assigned helper | `in_progress → check` | needs the handover proof; a receipt if there's a budget (unless the top-up was declined); no pending top-up |
| `handover` | seller | goods `held → check` | |
| `confirm` | customer / buyer | `check → released` | runs the split |
| `dispute {reason, note}` | customer / buyer | `check → disputed` | |
| `resolve {release\|refund}` | admin | `disputed → released \| refunded` | |
| `auto_release` | system | `check` past `checkUntil` → `released` | |

The DB trigger `deals_guard` → `deal_status_allowed()` repeats the allowed status pairs, so a buggy server still can't jump states.

---

# Appendix B — Routes and server actions

| Route | File(s) | What |
|---|---|---|
| `/login` | `app/login/{page,login-form,actions}.tsx` | phone OTP (`login`, `signOut`); dev shows the code |
| `/helpers`, `/helpers/[id]` | `(app)/helpers/…` | ♡ saved helpers; a helper's public profile (badges, ★, jobs, reviews masked) |
| `/welcome` | `welcome/page.tsx` | public landing (logged-out `/` redirects here); acting opens the login sheet (`components/login-prompt.tsx`) → `/login?next=` |
| `/` | `(app)/(tabs)/page.tsx` (+ `draft-chip.tsx`) | customer Home: map, search, active tasks, tiles. Helper mode → `/jobs` (proxy redirect) |
| `/earnings` | `(tabs)/earnings/page.tsx` | helper earnings plus a finished-jobs list |
| `/jobs` | `(tabs)/jobs/{page,online-card}.tsx` | helper: online/radius/location/push card, my jobs, my requests, offers, map, `?view=all&cat=&sort=near\|new\|pay` board; unapproved helpers see a checklist plus the board |
| `/post` | `(app)/post/{page,post-flow,actions}.tsx` | 3-step post: what → where (pin, saved addresses, details, timing, carry, buy-for-me) → review (people, raise price, breakdown, "Choose for me"). `?cat=&title=` or `?again=<id>`. Action `postTask` → `insertDeal` → `runDispatch` |
| `/tasks/[id]` | `(app)/tasks/[id]/{page,deal-view,pay-sheet,mock-qr,actions}.tsx` | customer task screen. `taskAction` intents: `simulate_payment`, `simulate_topup`, `rate`, `cancel`, `choose`, `confirm`, `decline_topup`, `dispute`; `pokeTask(id)` is polled |
| `/jobs/[id]` | `(app)/jobs/[id]/page.tsx` + `(app)/jobs/actions.ts` | helper job screen. `jobAction` intents: `skip`, `apply`, `quote`, `unapply`, `withdraw`, `start`, `finish` (`accept` is legacy). Also `setPresence`, `heartbeat`, `trackJob`, `prepareProof`, `submitProof`, `savePush`, `removePush` |
| `/profile` | `(app)/profile/{page,actions}.tsx` | mode switch, language, saved addresses (`removeAddress`), sign out |
| `/help` | `(app)/help/page.tsx` | how it works + live fees |
| `/ops`, `/ops/safety`, `/ops/pricing`, `/ops/incidents`, `/ops/helpers` | `(app)/ops/**` | admin hub: emergency switches and caps, live prices, SOS/incident queue, helper applications |
| `/dev/components` | `(app)/dev/components/{page,fixtures,actions,gallery-choices}` | component gallery; `?state=<fixture>` renders `DealView` from engine-built fixtures; only when `devToolsEnabled()` |
| `/api/cron/tick` | `app/api/cron/tick/route.ts` | Bearer `CRON_SECRET`; `settleDueDeals` + `runDispatch` for open deals |

Shell and layout:
- `app/layout.tsx` is the root.
- `(app)/layout.tsx` checks auth.
- `(app)/(tabs)/layout.tsx` adds the floating `TabBar` (a dot on History if something needs action).
- `loading.tsx` and `error.tsx` (`retry`) are the usual states.
- `src/proxy.ts` → `lib/supabase/proxy.ts updateSession` refreshes the session, redirects to `/login` (public: `/login`, `/api/cron`), and sends helper-mode `/` to `/jobs`.

---

# Appendix C — `src/lib` and `src/components`, file by file

**Engine (pure):**
- `engine/types.ts`: all domain types (see §4).
- `engine/config.ts`: `CATEGORIES` (bases: shop 6,000 · carry 15,000 · queue 8,000 · deliver 5,000 · repair 12,000 · other 7,000) and `DEFAULT_CONFIG`.
- `engine/deal.ts`: `createErrand`, `createGoods`, `generateDealCode`, `apply`, `liveOffers`, `autoPickAt`.
- `engine/money.ts`: `quoteFee`, `suggestFee`, `minFeeAt`, `isNight`, `errandSplit`, `buyerFeeFor`, `amountDue`, `heldItemBudget`, `bps`.
- `engine/ledger.ts`: `ext`, `payable`, `balanceOf`, `checkInvariants`.
- `engine/schedule.ts`: `dueCommand`, `runDue`.
- `engine/payouts.ts`: `withdraw` (only to a ДАН-verified name match; `namesMatch`). Not wired to UI.
- `engine/errors.ts`: `EngineError` (codes such as `ILLEGAL_TRANSITION`, `FORBIDDEN`, `INVALID_INPUT`, `PAYMENT_MISMATCH`, `PROOF_MISSING`, `INVARIANT_BROKEN`), `fail`, `assertMoney`.

**Persistence:**
- `db/mapping.ts`: `DealRow` ⇄ `Deal` (`dealFromRow`/`dealToRow`), `insertDealArgs`, `applyTransitionArgs` (new or removed offers, dispute, events, ledger, suspensions; `HELPER_PENALTY_DAYS = 3`), `actorFromProfile`.
- `db/deals.ts`: `loadDeal`, `insertDeal`, `runCommand` (retries on PT409), `DbError`.

**Read models:**
- `deals/queries.ts`:
  - **Customer:** `getDealForViewer` (+ lazy `settle`), `listMyTasks`, `timeline`, `publicProfiles` (the safe `public_profiles` view), `myRating`, `countNeedsAction`, `walletEntries`.
  - **Helper:** `listMyJobs`, `getPresence`, `myOffers`, `nearbyFeed`, `browseOpenDeals`, `myApplications`, `getJobForHelper`.
  - **Background:** `settleDueDeals` (cron).

**Dispatch:**
- `dispatch/plan.ts` (pure): `WAVES`, `score`, `bayesRating`, `pickWave`, `dueWave`, `distanceKm`.
- `dispatch/run.ts`: `runDispatch` (auto-pick → waves → push; closes offers when the task leaves `open`), `notifyChosen`, `openDealIds`.
- `dispatch/rank.ts`: `rankApplicants`, `pendingApplications` (`MAX_PENDING_APPLICATIONS = 3`), `releaseOtherCommitments`.

**Features:**
- `proofs.ts`: `createUploadSlot`, `recordProof` (checks the upload exists; flags `reused_photo`, `similar_photo`, `old_file`), `proofsFor` (signed URLs, 1 h). Bucket `proofs` (private, 25 MB, images and mp4/mov/webm).
- `proof-hash.ts` (pure): `dhashFromGray`, `grayFromRgba`, `hamming`, `SIMILAR_BITS = 6`.
- `push.ts`: `notify(userIds, {title, body, params, url, tag})` (per-device language; drops dead subscriptions), `saveSubscription`, `removeSubscription`.
- `maps.ts` (pure): `googleDirectionsUrl(dest, via?)`, `googlePlaceUrl`, `fuzz` (~300 m grid).
- `addresses.ts`: saved addresses through the user's RLS client (`listSavedAddresses`, `saveAddress`, `deleteAddress`).
- `payments/provider.ts`: `PaymentProvider` interface, `mockProvider` (invoice id `mock-inv-<deal>[-purpose]`), `mockPaymentsEnabled`.

**Auth and Supabase:**
- `auth.ts`: `getViewer()` (cached per request; reads the profile with the service role) → `{ profile, actor }`.
- `supabase/{server,admin,browser,proxy,env}.ts`: the user client, the service-role client (server only), the browser client (signed uploads only), session refresh, env access.

**Small utilities:**
- `format.ts`: `fmtMoney` (`46,000₮`), UB-time date helpers, `parseUbLocal` / `toUbLocal`.
- `labels.ts`: status tones, category icons, dispute reasons, rating tags, `describeEvent` (timeline text).
- `phone.ts`: normalize and format MN phones.
- `prefs.ts`: `setLocale`, `setMode` server actions.
- `mode.ts`, `mode-cookie.ts`: customer/helper mode.
- `dev.ts`: `devShowSmsCodes`, `devToolsEnabled`.
- `draft.ts`: localStorage key for the unfinished post.

**Components:**
- `ui.tsx`: `btn.*`, `field`, `Card`, `Note`, `HeldBadge`, `Avatar`, `FlowHeader`, `PrimaryBar`, `Skeleton`, `EmptyState`, `SegmentedLinks`, `chipClass`.
- `sheet.tsx`: `BottomSheet`, `ConfirmSheet`, `SubmitButton`, `ActionResult`, `FormAction`.
- `choice.tsx`: `PriceDeltaCard`, `OptionCard`, `DashedAdd`, `ToggleRow`.
- `inline-action.tsx`: one-tap form.
- `deal-card.tsx`: Home card or History row with `rowAction`.
- `offer-card.tsx`: applicant card with an optional badge.
- `step-tracker.tsx`: Matched → Paid → Working → Check → Done.
- `status-badge.tsx`, `money-breakdown.tsx`, `countdown.tsx` (server-time skew aware), `tab-bar.tsx`.
- `pin-map.tsx`: MapLibre pin picker; `MAP_STYLE` is OpenFreeMap.
- `task-map.tsx`: read-only markers `task | pickup | helper | me | job | area`.
- `map-slot.tsx`: old decorative placeholder (gallery only).
- `push-toggle.tsx`, `job-beacon.tsx` (live position every 30 s during a job), `auto-refresh.tsx` (polling, optional server-action poke).
- `proof-uploader.tsx`: camera → compress → sha256 + dHash → signed upload → `submitProof`.
- `proof-gallery.tsx`: proof photos and videos.

**i18n:** `index.ts` (`makeT`, typed `MessageKey`), `server.ts` (`getT`, `getLocale`), `client.tsx` (`useT`), `en.ts` (defines the shape), `mn.ts`. Top-level sections: `common`, `tabs`, `home`, `category*`, `task`, `post`, `deal`, `pay`, `money`, `dispute`, `rating`, `event`, `history`, `wallet`, `earnings`, `details`, `map`, `job`, `proof`, `push`, `profile`, `helper`, `login`, `error`, `lang`, `mode`, …

**Other:**
- `public/sw.js`: push service worker.
- `scripts/seed.ts`: demo users.
- `prototype/index.html`: the original single-file logic demo (historical).
- `reference/*.png`: UI references.
- `archive/`: long original specs.

---

# Appendix D — Database objects

- **Tables:**
  - `profiles` (role, `helper_status`, `kyc_level`, categories, rating sums, `completed_count`, `suspended_until`; server-only columns: phone, `verified_name`, payout).
  - `deals` (one table for errands and goods; `details` jsonb, `top_up` jsonb, `posted_fee`, `lat`/`lng`, `pay_by`, `match_by`, `check_until`, `version`).
  - `offers` (+ `price`), `disputes`, `proofs` (+ `mime`, `bytes`, `sha256`, `dhash`, `flags`, `ai`), `ratings` (+ `note`).
  - `messages` (chat: `helper_id` conversation key, `image_path`, `flags`, `seen_at`).
  - `ledger_entries` (append-only), `timeline_events`.
  - `saved_addresses` (+ `lat`/`lng`).
  - `helper_presence`, `dispatch_offers`, `dispatch_state`, `push_subscriptions`.
  - `call_signals` (call handshakes; deleted after 1 h).
  - `helper_applications`, `payout_accounts` (server-only; documents in the private `kyc` bucket).
  - `private.sms_outbox` (mock OTP).
- **View:** `public_profiles` (safe trust-card fields only).
- **Functions:**
  - **Writes:** `insert_deal`, `apply_transition` (v3; service role only).
  - **Guards and checks:** `deal_status_allowed`, `deals_guard` (trigger), `ledger_append_only` (trigger), `account_balance`, `ledger_invariant_violations`.
  - **Ratings:** `rate_deal`, `deals_count_completed` (trigger).
  - **Access helpers:** `private.is_admin`, `private.is_participant`, `can_see_in_feed`.
  - **Dispatch:** `dispatch_candidates`, `nearby_open_deals`.
  - **Auth / OTP:** `handle_new_user` (auth trigger → profile), `send_sms_hook`, `dev_latest_sms_code`.
- **Storage:** buckets `proofs`, `chat` and `kyc` (all private).
- **Tests:** `src/lib/db/__tests__/schema.test.ts` runs every migration in PGlite and covers:
  - an engine → DB round-trip for each flow (asserting the DB copy equals the engine copy);
  - optimistic locking, illegal status jumps, ledger tampering, double booking and append-only;
  - RLS for every role and the dispatch queries;
  - proof storage.
