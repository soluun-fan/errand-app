# Tuslamj Hub — context for an AI assistant

Read this first if you are a model picking up this codebase cold. It explains what the product is, how the code is put together, which rules must never break, what is built, what isn't, and where the weak spots are. Detailed rules live in `docs/*.md`; this file connects them.

_State as of 2026-11-14._

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
- **Phone numbers are never shown** to the other party. Chat and calls (planned) are masked or in-app.
- **All user-facing strings go through i18n** (`src/i18n/mn.ts` and `en.ts`).
- **Secrets live only in `.env.local`** (git-ignored). Never in code, never in git. Verified on 2026-11-13: nothing has ever leaked into history or the client bundle.
- **Database changes only as migrations** in `supabase/migrations/`. Never use the dashboard's "autofix".

---

## 3. Stack and how to run it

- **Next.js 16.4.6** (App Router), **React 19.3**, **TypeScript**, **Tailwind 4** (`@theme` tokens in `src/app/globals.css`).
  - ⚠️ Next 16 differs from older versions; see `AGENTS.md`.
    - `src/proxy.ts` replaces middleware.
    - `params` and `searchParams` are Promises.
    - `PageProps<"/route">` is a global type (regenerate with `npx next typegen`).
    - Use `refresh()` from `next/cache` in server actions.
    - `error.tsx` receives `retry`.
  - Read `node_modules/next/dist/docs/` before using an API you're unsure of.
- **Supabase:** Postgres, Auth (phone OTP), RLS, CLI 3.1. The hosted project is linked.
  - `@supabase/ssr` for cookies; `getClaims()` for auth.
  - The service-role ("secret key") admin client is for server code only.
- **Tests:** **Vitest**. The database tests run the real migrations in **PGlite** (Postgres compiled to WASM, in-process), with stubs for Supabase's `auth` schema and roles (`src/lib/db/__tests__/pg.ts`). **163 tests** cover the engine, money, transitions, simulation, the DB round-trip, RLS, dispatch and maps.
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
| `npm run seed` | seed demo users (`scripts/seed.ts`) |

**Env variables** (names only; values are in `.env.local`):
- **Server-only secrets:** `SUPABASE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.
- **Public by design** (end up in the browser): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- **Other:** `VAPID_SUBJECT`, `DEV_SHOW_SMS_CODES`, `PAYMENT_PROVIDER` (default `mock`).
- **Planned:** `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and a vision-model API key.

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
- `config.ts`: all numbers.
  - Fees: min fee 5,000; service fee 1,000; commission 10%; cancel fee 3,000.
  - Time windows: 24 h check window; 30 min no-helper deadline; 10 min to pay; instant requests lapse after 15 min; auto-pick after 3 min.
  - Prices: per km 1,500; per floor without a lift 1,500; 2nd person 15,000; round trip +50% of the distance part; night minimum 6,000 (22:00–07:00 UB time, UTC+8).
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
  - `GET /api/cron/tick` (Bearer `CRON_SECRET`; also settles due expiries and auto-releases). **No production scheduler is wired yet.**
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
  - After payment they see the exact pin, address, details and a directions button.
  - While a helper is matched or working, their phone sends its live position every ~30 s (`JobBeacon` → `trackJob`). Only that task's customer sees it.
- **Push:** VAPID Web Push (`public/sw.js`, `push_subscriptions` with a per-device locale). It notifies helpers of new nearby tasks, and covers chosen, paid, new applicant, helper accepted and auto-chosen events.
- **Planned:** owner-provided Google Maps key → Google map tiles, Places search, and Routes ETA, with MapLibre as the fallback.

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

All seven are applied to the hosted project.

**RLS model:**
- Clients (`authenticated`) only **read**, and only their own rows or rows they participate in. Approved helpers can also read open tasks in their categories.
- Every write goes through server code using the service role, after the server has checked the user (and, for money and status, after the engine has).
- Exceptions: users may update their own name and area, and write their own `saved_addresses`.

---

## 9. UI and conventions

- **Layout:**
  - `(app)/(tabs)` has a floating 3-tab bar. Customer tabs: Нүүр · Хэтэвч · Түүх. Helper tabs: Ажил · Орлого · Түүх.
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
- Wallet, history and earnings read from the ledger.
- Dev gallery.

**Not built yet** (rough priority):
1. **Proof upload** (photo/video to Supabase Storage). Helpers can start but can't finish in the real app yet. Plan: PaddleOCR for receipt totals, plus a hosted vision model to flag bad proof (flags only; Ops decides).
2. **Chat, voice and video calls** inside the deal (LiveKit Cloud first), with phone numbers masked.
3. **Two-way ratings** (helpers rate customers; each side's rating hidden until both submit).
4. **SafePay screens** (the engine exists).
5. **Ops panel:** disputes, helper approval/KYC (ДАН), payouts.
6. **Production scheduler** for `/api/cron/tick` (plan: Supabase pg_cron + pg_net every 15–30 s).
7. **Real QPay / bank adapters** behind `PaymentProvider`, with webhook verification.
8. **Supabase Realtime** to replace polling.
9. **Multi-person jobs** ("keep recruiting", split payouts).
10. **Pickup pin** (pickup is text only today).
11. **Google Maps tiles, Places and Routes** once the owner adds a key.
12. **Native review of the Mongolian copy.**

---

## 11. Things worth pondering (known weak spots and open questions)

- **Dispatch races:** two concurrent `runDispatch` calls can send a wave early. Duplicate offers are blocked by the primary key, but the wave/state upsert isn't compare-and-swap. A `dispatch_state` version or row lock would fix it.
- **Cross-deal invariants live in app code, not the DB:** the 3-open-requests limit and `releaseOtherCommitments` are server-side best effort (errors swallowed per deal). A helper could still end up matched and paid on two tasks if two payments land at once. Options: a DB constraint or advisory lock per helper, or a "busy" flag checked in `apply`.
- **Payment lapse versus a late webhook:** if the bank confirms after a match lapsed, `confirm_payment` throws. The provider adapter must then refund. That path is documented but not implemented, because the mock can't produce it.
- **Web geolocation limits:** background tracking stops when the screen locks. Reliable live tracking and push on iOS need a PWA install or a native app.
- **Privacy:**
  - The 300 m fuzz is a fixed grid, so repeated tasks from one home always land in the same cell; jitter per deal may be better.
  - The pickup address text is shown pre-match (fine for stores, not for homes).
  - `helper_presence` holds precise live locations. Retention and deletion policy are undecided.
- **Trust and safety:** helper KYC is a field (`kyc_level`), not a flow. There's no rate limiting on actions. Dispute evidence (proof photos, chat logs, call recordings) isn't stored yet.
- **Unit economics:** service fee and commission are demo numbers; partner-bank and QPay fees aren't modeled.
- **Legacy data:** deals paid at posting (the old flow) still work through special branches (`assignHelper` with `heldAmount > 0`, refunds on cancel/expire). They can be removed once no such deals exist.
- **Testing gaps:** client interactions (maps, sheets, push, geolocation) are verified only by server-render checks and scripts, not in a real browser or on a phone.

---

## 12. Working with the owner

- The owner **commits and pushes themselves**. End a work session with test and build status plus the exact `git` commands. Don't commit for them.
- They decide quickly when given **concrete options with a recommendation** (they usually take the recommended one).
- Ask before anything outward-facing: hosted `db push`, deleting data, sending to external services.
- **Keys:** never ask them to paste keys into the chat. They put them in `.env.local`.
- **Language:** they write in English; the app is Mongolian-first.
