# Decisions & open questions (read only when asked "why")

- **2026-11-24 — Settle it between customer and helper (owner picked no-show, settle-first,
  on-my-way + reliability; "not too discouraging for helpers — UB traffic").** The app supplies the
  facts, the two people decide, Ops is the fallback. Migration `20261124000000`.
  - **On my way:** `on_my_way` (matched) shares location from then (not only at Start); the
    customer sees it on the map.
  - **Need more time?** `need_time` +15/+30 min (total ≤ `max_delay_minutes`, before being late):
    arrive-by moves, **no late mark**; the customer is told and may cancel free.
  - **Customer no-show:** `customer_absent` only when the helper is at the customer's place
    (same location check as Start); the customer gets `absent_grace_minutes` to tap "I'm here";
    otherwise `absent_cancel`: the helper is paid the trip fee + shopping already bought, the rest
    is refunded.
  - **Settle first after "done":** either side may offer a lower price (a partial refund, down to
    0, minimum price not applied); accept = difference refunded at once; auto-release waits while
    an offer is open; unanswered after `settle_hours` → `escalate_offer` (dispute "no_agreement").
  - **Reliability shown positive-only** (on-time %, jobs done); late marks stay private.
  - Lateness discount was not chosen.

- **2026-11-24 — Place search and busy areas (owner: "do those you can do later").**
  - **Place search** on the pin picker (`src/lib/geocode.ts`, `src/components/place-search.tsx`):
    Photon (komoot, OpenStreetMap), key-free, Mongolia only, biased to central UB with a fixed point.
    Only the typed text is sent, never a position or pin (stated in the privacy policy). Names are
    tidied (traditional script removed, "Улан-Батор" → "Улаанбаатар"). Reverse lookup ("address
    from pin") is deliberately not done: it would send home coordinates to a third party.
  - **Busy areas** on the helper's nearby map (`src/lib/busy-rules.ts`): open tasks counted per
    0.01° square (~1 km), coarser than the ~300 m blur; the map still frames the helper's own jobs.

- **2026-11-24 — Google-Maps-like maps, still key-free (owner picked the free option over real
  Google Maps).** `src/lib/map-style.ts` restyles OpenFreeMap "liberty" in the browser: grey land,
  white streets, warm main roads, blue water, green parks, grey labels; no relief, 3D buildings or
  US shields. Street/POI names in Cyrillic; place names (city, district, neighbourhood) Mongolian if
  tagged else Latin, because OSM stores many in both scripts in one string; the city name hides at
  street zoom. Markers (`src/components/map-ui.tsx`): teardrop pins (red = place/drop-off, dark =
  pickup), blue "you are here" dot with halo, round locate button, solid blue route with a white
  edge, white price chips. Flat, north-up (no rotate/tilt). The pin picker's pin lifts while
  dragging and drops back. Credits fold to ⓘ after 5 s or the first drag (OSM guidelines).
  The restyled style is validated against the MapLibre style spec in tests.

- **2026-11-23 — Review fixes, contact, privacy.**
  - Code review of 2026-11-22/23: approved helpers without an ID-checked name could never get a
    bank account approved → Ops may confirm the ID in the same bank check (`identityConfirmed`,
    approved helpers only). ID approval now tells Ops a bank check is waiting. Bank checks log
    their outcome (`payout.checked`). Accounts verified under the old name-only rule go back to the
    check queue (migration `20261123020000`).
  - **Help & contact:** channels set by Ops at `/ops/support` (any may be empty) and "Message our
    team" (Ops inbox + push, 5 a day per person, contacts masked). Ops calls back.
  - **Privacy:** idle helper positions cleared (1 h offline / 24 h stale); job routes deleted when a
    helper closes their account; the privacy page states route retention from the live setting.
    The fixed ~300 m blur grid stays on purpose (per-task jitter would let overlaps narrow a home).
  - Old error-log entries of 2026-11-19/20 came from back-to-back deploys and missing migrations;
    none recurred, so they are stale.

- **2026-11-22 — Quick bundle + settings (owner: "sure… I accept those").**
  - **"Want to raise the price?"** (not a fixed +1,000₮): after `nudge_after_minutes` with no
    application the customer sees +500 / +1,000 / +1,500₮ or their own amount (`set_price`); the
    waves restart so helpers hear the new price (`resendAfterRaise`).
  - **First task free:** no service fee until the customer's first real pay-in
    (`isFirstTask`, Ops switch `first_task_free`).
  - **Helpers rate customers** after release (`rate_customer`, `ratings.about = 'customer'`,
    `profiles.customer_rating_*`); helper reviews only read `about = 'helper'`. Helpers see the
    customer's rating on the job.
  - **Install prompt** on Home (Android prompt; iPhone Share → Add to Home Screen).
  - **Cancellation reasons** (optional, `CANCEL_REASONS`) on the timeline.
  - "N helpers online" already existed on Home.
  - **Into Ops settings:** night-price hours, open applications per helper, helper position
    freshness, SOS re-alert timing, chat retention (migration `20261122050000`). Code keeps the
    old numbers only as a fallback. Dispatch waves were already settings.

- **2026-11-22 — Service fee (owner picked option A).** The customer's fee is **10% of the
  helper's price, rounded to 100₮, at least 500₮, at most 5,000₮, nothing on shopping money**;
  helpers keep 100%. Like Haejuseyo/UBCab it scales with the job (small jobs pay little), but it
  stays on the customer side. Ops settings `service_fee_bps/min/max` (migration
  `20261122030000_service_fee_share.sql`); share 0 returns to the flat steps. SafePay keeps the
  flat steps. Saved on each task at posting. Help and Terms describe it from the live settings.
  Still open: VAT on full turnover (accountant) may change the numbers.

- **2026-11-22 — Helper standards (owner: "workers are lackluster… firm and careful approach").**
  Supersedes the opt-in part of "Foreground worker tracking" (2026-11-20):
  - **Location is required during a job** (from Start until finished, never before or after).
    The customer sees the helper live; consent goes in the helper agreement.
  - **Late / not moving / no-show:** remind the helper, tell the customer, free cancel + re-post
    after a limit. Marks build a ladder: warning → ranked lower → pause; removal only after Ops
    review; helpers see their record and can appeal. Customer-caused delays don't count.
  - Build before the quick bundle. Route history kept **30 days** (owner, 2026-11-22).
  - **Built (migration `20261122020000_helper_standards.sql`):** sharing switches on at Start and
    can't be switched off while the job runs; route points (≤ 1 per 20 s) for disputes, purged by
    the tick. Start only within `arrive_radius_m` of the pickup pin (task pin for one-place tasks;
    two-place tasks without a pickup pin aren't checked). Arrive-by = booked time, or chosen +
    `arrive_minutes`; late after `late_grace_minutes`: the tick runs `mark_late` (helper + customer
    pushed), the customer may `replace_helper` or cancel with no fee to the helper. Events
    `helper_late` / `helper_no_show` → one `helper_marks` row per job → ladder (ranked lower in
    dispatch, pause, paused until Ops lifts it at `/ops/marks`). Helpers see `/helper/record` and
    can explain a mark; Ops voids marks. "Not moving" is deliberately not punished (queues and
    waiting jobs stand still); a stopped location only gets a reminder. All limits in `/ops/rules`.
  - Lawyer check: safety/proof tracking is fine, but control over *how* contractors work must
    not make them look like employees.

- **2026-11-22 — Pricing approach (owner).** The customer still names the price; we set only the
  minimum. Additions, all Ops settings:
  - **No-applicant nudge:** if a task gets no applications for a few minutes, offer one tap
    "Raise by 1,000₮?" and dispatch again. The customer may ignore it.
  - **First task free:** the service fee is waived on a customer's first task, once per verified
    phone; Ops can switch it off.
  - **Payout bank fee:** we absorb Golomt's per-transfer fee; helpers receive the full amount
    (the daily withdrawal limit keeps the cost down).
  - **Price hints:** "similar jobs went for about X" only once a category has enough finished
    jobs (about 20+).
  - **Open (accountant):** whether the full job price counts as our revenue for VAT under the
    managed-service model. If so, the service fee tiers must be re-sized before launch.

- **2026-11-22 — Payouts via Golomt Corporate Gateway.** The business account is at Golomt, so
  outgoing transfers and account-name checks go through Golomt's Corporate Gateway; wire.mn
  stays for customer collection only. Blocked on the CGW contract and Golomt's written answers
  (token confirmation, other-bank name lookup, sandbox, idempotency); see
  [Golomt section](bank-payout-integration.md#selected-bank-golomt-corporate-gateway-2026-11-22).
  Until then payouts remain manual with a required bank reference.

- **2026-11-22 — Bank ownership is separate from identity approval.** A typed name and an ID
  check cannot verify a bank account. New/changed accounts require an independent bank check;
  manual Ops review records evidence against the exact account snapshot. Manual transfer
  completion requires a bank transaction reference. Real automatic sending remains blocked on
  the business bank/provider connection; [integration requirements](bank-payout-integration.md).

- **2026-11-22 — Guigere service-model review and earnings clarity.** Prepare the standing
  provider agreement, individual job order and customer booking terms for Mongolian counsel,
  accountant and payment-provider review; see [review packet](managed-service-review.md).
  Contractor status and payment licensing are separate questions. No legal acceptance version
  changes in this release. Distinguish active work, completion review, overdue approval and
  disputes from approved earnings; distinguish payout requests from bank transfers. Use the
  configured automatic-request age and show recorded request/decision dates. Fail a financial
  summary when any essential read fails rather than presenting a false zero. Recent job rows
  are drawn from the latest 50 assigned jobs; headline amounts come from the full ledger.

- **2026-11-21 — Tracking recovery and deployment audit.** Keep worker opt-out available when
  device permissions fail, provide retry for location errors, and acknowledge saved sharing consent
  without requiring a second successful read. Preserve the map and navigation link after a tile
  error. Do not equate pg_cron's successful HTTP enqueue with a healthy application tick: require
  a recent successful app heartbeat and propagate database write failures. No new migrations.

- **2026-11-20 — Foreground worker tracking.** Keep per-job sharing opt-in and separate from dispatch
  presence. Sample in the signed-in layout so chat navigation and stationary workers retain fresh
  locations. Surface failed saves and expire customer markers after 90 seconds without a fresh
  sample. No background or locked-screen GPS guarantee. Read-only deployment checks verify exposed
  database tables and the actual scheduler heartbeat.

- **2026-11-19 — Launch scope for care and accompaniment.** Direct childcare, eldercare and personal or medical care are outside the launch offering. Families can book shopping, deliveries, queues and wayfinding for an adult who travels independently. Who will be home is private. For accompaniment, several helpers can apply and the customer can review portfolios, chat privately and choose. Existing assigned bookings retain their original terms.

- **Edge** = held payment + photo proof + disputes, not the algorithm. Answers "why pay a middleman vs Facebook/direct-pay apps".
- **Don't compete on plain A→B delivery**: the reference super-app already does it (courier inside, multi-stop, round trip, cargo). Lead with buy-for-me, carrying upstairs, queues, helping hands, small fixes, SafePay.
- **Launch narrow**: 2–3 adjoining khoroos, a few task types; heavy moving later. Measure 100–200 paid tasks: match rate, time to match, cancel rate, net per job, 30-day repeat.
- **AI photo draft** suggests only; never decides weight/fit/safety. Photos deleted after the dispute window.
- **Pricing**: system price for Instant (customer may raise); quotes for Custom.
- References: Haejuseyo (errand rules), Airtasker (offers → held → release), Lalamove (stops, add-ons, Help Buy), Karrot (safe pay confirm, trust score), Bunjang/Escrow.com (check window).
- Competitors to test-post on: Ubwork, Handle+, Lavlah, Oneday JOB (claims unverified).

Open: Bank of Mongolia licensing for holding funds · M Bank API (per-deal hold, release speed) · QPay fees/onboarding · ДАН access · SMS OTP + masked calls (Mobicom/Unitel) · final fee values · product name.
Rollout: Stage 0 = pay helper via QPay after the job, app only records it. Stage 1 = held payments after bank deal + legal review.

## Decisions log (implementation)
- **2026-11-19 — Easier task entry:** one message with category-specific examples replaces the separate required title and description; its first line provides an editable short title. Addresses are separate pickup/destination cards with saved and recent suggestions. The map for each address appears inline. A pin is saved when confirmed. Typing a different address clears its old pin and destination directions. Entrance details and extra task options expand when needed; review has direct edit buttons. Draft restoration finishes before saving so refresh cannot overwrite the stored message. Text address geocoding remains deferred.
- **2026-11-18 — More active tasks cost a little more** (owner: "you can post more than 3, by making the app charge higher, like adding 500"): a customer's first 3 active tasks pay the normal service fee; each one beyond adds 500₮ to its service fee (`pricing_settings.free_open_tasks` / `extra_task_fee`, Ops-editable; the engine adds it at posting from the server's count and records it in `details.extraFee`). The hard ceiling is `platform_controls.max_open_tasks` = 10.
- **2026-11-18 — Not-urgent posts** (owner: "keep a post for 24 hours, it may be not very urgent job"): a "Яаралгүй · 24 цаг" choice when posting. It's the engine's `mode: "schedule"` without a time: open for the Ops search window (`platform_rules.schedule_match_window_hours`, 24 h), offers don't lapse, "Choose for me" is off (the customer compares at leisure); after the window it closes with nothing charged. Cards show "Яаралгүй · … хүртэл" instead of "Одоо".
- **2026-11-18 — Task conditions** (owner: "follow schedule and time, or to have driver id … discuss before deciding … call"; picked: driver's licence, own car, talk first, on-time record, background-checked only, languages, handover code): stored in `details.require` at posting. Only helpers who meet them are notified, see the task nearby, can apply and can be chosen — the engine (`missingConditions`, from server-computed `actor.badges`) and the database (`private.meets_conditions`, triggers on offers and assignment) check the same rule. Licence / car: `helper_badges`, a document Ops checks at /ops/badges (expires). Background check = kyc 4. Languages: `profiles.languages`, self-declared. On time: last 20 booked jobs, started within 10 min of the agreed time; < 3 jobs = no record (allowed), else ≥ 90 %. Talk first: the care call rule on any task (`care_call_done`). Handover code: 4 digits in the server-only `handover_codes`, shown only to the customer; the helper enters it to finish (5 wrong → 15-min lock); the database refuses "done" without it. Helpers manage these at /helper/badges.
- **2026-11-18 — Direct pay + wire.mn** (owner: "connect the payment method to wire.mn (for now we cant do any escrow)"; picked: only our fee through wire, the helper paid directly; the fee refunded unless the customer cancels late):
  - Tasks carry `payMode` ('held' = escrow, older tasks; 'direct' = fee only), fixed at posting from `platform_rules.pay_mode` (default 'direct'; with wire.mn always 'direct' — wire can't hold money). In 'direct': `amountDue` = service fee; release → the fee to the platform, nothing to the helper; customer cancels after paying → fee kept (`fee_kept`), no cancellation fee to the helper; helper back-out / dispute refund → fee refunded; price changes simply count; no top-ups.
  - wire.mn: PaymentIntent + hosted checkout; signed webhook `/api/payments/wire` (HMAC-SHA256 `t.body`, 5-min tolerance, events deduplicated); return page asks wire directly if the webhook is slow; a payment the engine won't accept is refunded in full. Refunds go against the charge; `provider_refunds` is retried by the tick until wire confirms; `manual_required` / repeatedly failing ones show on /ops/payments.
  - The helper's pay: `direct_payments` — the customer sees what's owed (price + receipt) and the payee's account (the company's for an organisation's job), marks "paid"; the helper marks "received" or reports "not paid" → Ops alerted, the customer can't post until Ops settles it on /ops/payments.
  - All texts that promised "the bank holds your money" were rewritten for this model; tasks still in escrow keep their wording. Open: helpers' earnings page doesn't count direct pay yet; no cancellation fee for helpers when a customer cancels late in this mode.
- **2026-11-19 — Name: Гүйгээрэй (Guigeeree)** (owner picked it over "Заруулий": "зарах/зарц" sounds like ordering a servant and also means "to sell"). One setting: `src/lib/brand.ts` (code, titles, app icon name, SMS, payment text) + `common.app` in the texts, which use `{app}`; Mongolian case endings go on "апп" ("{app} апп-ыг"), so a future rename needs no grammar edits. Icon letter "G" (the icon font has no Cyrillic). Documents re-versioned 2026-11-19, so everyone accepts once. Still for the owner: trademark search, domain, social handles.
- **2026-11-18 — Registration and terms** (owner: "make it finished. ins and outs. registration and conditions all carefully set"; spec A3, A5, A7):
  - **Sign-up:** after the SMS code a new person gives a display name (letters, 2–40), date of birth (18+, checked by the app and the database) and accepts the **Terms of service** and **Privacy policy**. Each acceptance is stored with its version (`legal_acceptances`) and on the profile; when a version in `src/lib/legal-rules.ts` changes, everyone is asked again before using the app.
  - **Helpers** accept the **Helper service agreement** on the application (contractor, per-task fee, withdraw-only earnings, back-out pauses, taxes). If it changes, they get a to-do and can't apply / start until they accept it again.
  - **Documents** at `/terms`, `/helper-terms`, `/privacy` — public, marked DRAFT for the lawyer, and quoting the live settings (fees, windows, trip fee, pauses, withdrawal limits), so they always say what the app does.
  - **Closing an account** (Profile, type "хаах"): only with no active tasks, no earnings still owed and no open "not paid" report; Ops accounts are closed by another admin. Removes name, birth date, bank account, devices, saved places, presence and public photos; blocks sign-in; keeps tasks, payments and ratings without the name (payment records must be kept by law).
- **2026-11-18 — Launch readiness: phone, location, notifications; errors; SMS; relay** (owner: "make it mandatory that errands run on phones … location on or else no errand … notifications"; picked helpers only, Mongolian SMS gateway, Cloudflare TURN, Vercel Pro Seoul):
  - **Helpers:** going online, applying, taking a price and starting a job need a phone browser, notifications on (a saved push subscription) and a position from the last 15 minutes. The page shows a "get ready" checklist with one button per step (iPhone: add to Home Screen first, iOS only allows notifications for installed apps); the server refuses the same actions (`src/lib/work-ready.ts`). Browser tests bypass it only with `E2E_DEVICE_BYPASS=1` on the test server + a cookie; `check:deploy` refuses the variable. Customers get a "turn on notifications" card on Home but can post from a laptop.
  - **Error alerts without an outside service:** server errors (`instrumentation.ts` onRequestError) and browser errors (a page listener + the error screen) are grouped in `app_errors`; Ops gets a push for each new kind and at most hourly after; `/ops/errors` lists them, "Fixed" closes one (it reopens if it returns).
  - **SMS:** Supabase's Send SMS hook (HTTPS) → `/api/auth/sms` (Standard Webhooks signature) → the gateway request built from settings (`SMS_HTTP_*`), so any gateway with an HTTP API works without code. The code is never logged.
  - **Calls:** Cloudflare TURN (`CLOUDFLARE_TURN_KEY_ID` + token) gives short-lived relay credentials; calls are then relay-only. If no relay is available, calls are refused (never direct), see `iceConfig`.
  - Step-by-step go-live list: `docs/deploy.md` "Go-live checklist".
- **2026-11-18 — Managed service, Phase 1** (owner's "V1 Master Spec": the customer buys the errand service from our business; helpers are independent contractors paid per task; replaces escrow and the fee-only direct pay; lawyer/accountant items A7 still open):
  - New tasks take the **full amount** (`pay_mode` held): price + shopping budget + "service & safety fee" 1,000 / 1,500 / 2,000 / 3,000₮ (job total under 10,000 / 30,000 / 60,000 / above — owner split the spec's 1,500₮ band) + the +500₮ extra-task fee. Through wire.mn when it's switched on (first payment, shopping top-ups and agreed price increases all go there now); the mock otherwise. Older fee-only tasks finish as they were.
  - Suggested price = minimum × 1.25 pre-filled; minimum stays the per-kind floor; largest job total 200,000₮ (saved on the task, so counters and price changes are held to it). Payment window 10 min for "now", 30 min for booked / not-urgent. Check period 3 h. All in Ops (pricing / rules).
  - **Earnings + Withdraw:** on confirm the helper's earnings grow; they withdraw everything available (min 3,000₮, 2 a day) to their own **checked** bank account; Ops sends it from the bank app at /ops/withdrawals (copy buttons, PAYOUT reference) and taps Sent or Failed (money back to earnings). Ledger: payable → payout (asked) → ext (sent). Unclaimed earnings are asked for automatically after 30 days. Accounts added without an ID-checked name wait for Ops to compare them with the ID.
  - **Day jobs stay one-off help** (owner: "gig workers are contractors"): advertised and priced per job (no "per hour" label), at most 8 day jobs per poster–helper pair in 30 days (database), no shifts or minimum hours. Lawyer to confirm.
  - Wording: no "wallet / цалин / ажилтан"; "the bank holds your money" replaced by "you pay Tuslamj; we pay the helper after you confirm". Phone numbers stay hidden always (owner, overriding spec C11).
  - Next phases: bank transfer + Ops confirmation, card earnings on hold 24 h, new-helper caps, customer ID for big/night/shopping tasks (2); zones, hours, standby, seeded jobs, study help (3); rewards, referrals, reports (4).
- **2026-11-18 — Bank account before working** (owner: "the user has to put their bank account to even log in as a worker"): in the fee-only mode customers pay the helper straight into their account, so a helper without one can't be paid.
  - Sign-up already required it; the gap was helpers approved without one (the demo helpers, and anyone approved before the account table). Now in worker mode they see only "add your bank account" (/helper/bank), can't go online or apply, and customers can't send them direct requests.
  - The database agrees: no account → not notified (`dispatch_candidates`), nothing in the nearby feed, applications refused (`offers_payout` trigger).
  - Changing it later: the holder must match the helper's ID-checked name (a stolen phone can't redirect someone's pay); then it counts as checked. A helper with no checked name may add one and Ops is pushed to compare it with the ID. Every add / change is in the audit log; the profile keeps only the last 4 digits.
  - Organisation workers still need their own account (for everyday jobs); organisation jobs keep paying the company's account.
- **2026-11-18 — Work photos: portfolio + photos in reviews** (owner: "put it in the worker's portfolio kind of thing. and also just in the homepage"; PleaseHelp's home is full of finished-job photos: helper portfolio, review photos, thumbnails on helper cards):
  - **Review photos:** the customer adds up to 3 when rating (told they're public, name hidden). Shown with the review; count toward the helper's portfolio only if the review is 4★+.
  - **Portfolio:** on a finished job the helper picks up to 4 of their own handover / progress photos (JPEG, not taken back). They go public only after that job's customer taps "Allow" (push + card on the task). "No" is final for those photos.
  - Never for care work. Shown with the kind of job, month, helper name and ★ only — never the task's words, place or the customer.
  - **Where:** helper profile (portfolio grid + photos under reviews), helper cards (3 thumbnails), Home and the landing page ("Туслагчдын хийсэн ажил", max 2 per helper), review cards (photo on top; reviews with photos first).
  - **Taking down:** the helper, the task's customer or the uploader can remove any time; anyone signed in can report (reason); 3 reports hide it automatically and Ops is pushed on the first; Ops hides at /ops/photos (logged). Removed / hidden / declined never come back.
  - **Files:** uploads wait in the private bucket; only on "shown" the server re-checks it's a JPEG and copies it to the public `work-photos` bucket under a random name; taking down deletes that file. The database (`work_photos_check`) enforces who may add what, the limits and finished-only.
- **2026-11-18 — Rules from the database** (owner: "less hardcode and more backend and database"): tunable timings and limits moved to the single `platform_rules` row, edited at **/ops/rules** (logged): payment window, check hours, search windows, application freshness, "Choose for me" delay, direct-request time, max applicants, free back-out window, back-out pauses (1st / 2nd / 3rd+, care), care hours / longest booking / required call, and the helper-notification waves. The cancellation fee joined `pricing_settings`. A task copies the timings it runs by at posting (`details.rules`, like `details.minFee`), so a change never moves a running task; older tasks fall back to the engine defaults. The database reads the same row for the pause lengths (`apply_transition` v9) and the care call (`care_call_done`). What stays in code on purpose: money math, task states, access rules, anti-abuse limits (chat / call rates, upload sizes) — the database double-checks those. User texts now show the live numbers instead of fixed ones.
- **2026-11-17 — Changing photos** (owner: "i cant delete photo or change"): the customer removes / adds task photos (≤ 5) while the task is open — they're not evidence, so they're deleted; once a helper is chosen they're fixed. The helper takes back their own progress / handover photo while the job runs: proofs are evidence, so it's only hidden (`proofs.removed_at/removed_by`), still shown to Ops marked "removed by the helper". Start photos and receipts can't be removed (the start is the arrival record; a new receipt already replaces the amount). Finishing needs a handover photo (or care check-out) that is still there. No photos on care tasks.
- **2026-11-17 — Minimum per kind** (owner: "taking out trash is easier than grocery shopping … cheaper. hard labor … higher minimum. the shift … hourly wage and duration"; the minimum follows the distance estimate): a task's floor = its kind's own minimum (`category_settings.min_fee`) — or, for hourly kinds, the hourly floor × hours (`min_hourly`) — plus the trip (distance beyond the included km, and the way back) and the night extra; a second person doubles the labour part. Starting values: rubbish 3,000₮, small repair 6,000₮, assembly 8,000₮, carrying 10,000₮, plumbing / electrical 15,000₮, cleaning 20,000₮; day job 6,000₮/h (owner lowered it to 4,000₮/h on 2026-11-18, in Ops), babysitting / elder care 8,000₮/h; the rest use the general minimum. Ops edits them at /ops/pricing (logged). The engine saves the floor on the task at posting (`details.minFee`); counter-offers and price changes are checked against it, so a later settings change never moves an existing task. The engine's built-in default stays flat; the per-kind values live only in the database.
- **2026-11-17 — Shifts planned** (owner: day jobs / short gigs in their own section, anyone may post, "we can still hold the money … to avoid scamming"): one shift post + one held errand deal per worker, so each worker's money, attendance and disputes stay separate. Plan and lawyer questions in `docs/shifts.md`; build after the launch blockers.
- **2026-11-17 — Pictures** (owner: "photos make it feel real and legible … i can add random photos at the start … do whatever the pleasehelp one does"):
  - **Task thumbnails:** the helper's cards (nearby, all, my requests) and the customer's past tasks show the task's first photo (signed, 1 h) — only where that task is already visible.
  - **Kind covers:** Ops uploads one example picture per kind (/ops/content, logged). Cards use it when a task has no photo, **marked "Жишээ" (example)** so nobody mistakes it for the real job; Home's kind tiles and the public request boards use covers only — never a customer's photo. Covers are generic, so their bucket (`kind-covers`) is public; task photos stay private.
  - Owner's job: pick pictures we have the rights to (own photos, or free stock such as Unsplash / Pexels), no real customers' faces.
- **2026-11-17 — Helpers missing a new kind:** an approved helper opening an everyday task of a kind they haven't picked gets one button: add the kind to their work and apply.
- **2026-11-17 — Care pilot + trip time** (owner: "babysitting and stuff...can we?" → "sure" to the pilot list; "wouldnt the price match the duration they go through"):
  - **Trip time:** "About how long?" now starts at the kind's usual time + travel (3 min/km per leg in UB traffic, `pricing_settings.travel_min_per_km`, Ops-editable), so a return trip is priced by its time too. The customer can still pick another length; the form says how much of it is travel. The "Буцаж ирэх" switch is explained as "the helper must come back to the start".
  - **Care limits (engine):** daytime only, 08:00–21:00 Ulaanbaatar time, at most 6 hours (`careDayStartHour`, `careDayEndHour`, `careMaxMinutes`).
  - **Scope text** on posting and on the helper's job: babysitting = care, play, meals, bedtime, medicine only if written down; elder care = company, walks, meals, errands, no medical tasks.
  - **Meet first:** choosing a sitter the family hasn't had a finished care job with needs a ticked "someone from the family stays at home" (server-checked); the helper sees "first session" on the job.
  - **Check-out instead of a handover photo** for care: a proof row with time + position and no file, then `record_handover` (engine unchanged).
  - **First-aid badge:** a care clearance can claim a first-aid certificate (`helper_certificates.first_aid`); Ops is reminded to check the file; approved → 🩹 badge on the applicant card.
  - **Back-outs:** a late back-out from care work pauses 7 days at once (`apply_transition` v8).
  - **Ops alert** when a family rates a care job below 4★ (problem reports already alert Ops).
  - Still the owner's: lawyer check (liability, terms, any licence for childcare), insurance, Ops checking the criminal-record certificate against the official source. Care stays **off** until then.
- **2026-11-17 — Backing out** (owner: "penalty for commission rejection after accepting — after 10min or so. and immediately the commission post is posted like anew again and notified"; picked: escalating pause, refund and pay again, clock from being chosen):
  - The chosen helper can back out until the job is finished. **Free within 10 minutes of being chosen** (`deals.assigned_at`); later = penalty.
  - The task is **not cancelled**: everything held is refunded, receipt / top-up / handover / price change are cleared (a paid top-up's extra budget is taken off again), the helper's offer is removed, a fresh match window starts, a direct request to that helper opens to everyone. The app then restarts dispatch from the first wave (the helper who backed out stays marked declined) and tells the customer. The customer pays again when they choose the next helper.
  - **Pause:** 1st late back-out in 30 days = 1 day, 2nd = 3 days, 3rd or more = 7 days and a push to Ops. The database decides the length (`helper_penalties`, `apply_transition` v7). The helper sees which applies before confirming. No money is taken.
  - The DB guard "cannot change the recipient of a paid job" now has one exception: back to nobody, with everything refunded and the task open.
- **2026-11-17 — more photos** (owner: "in the real pleasehelp app/web they constantly took pictures"; picked: photos when posting, start photo, progress photos):
  - **Start photo:** required to start (taking it runs `start`; the plain button refuses without one). Server-action rule, not engine: it's evidence, not money.
  - **Progress photos:** optional, any time while in progress, ≤ 20 per task, note ≤ 140 chars (contacts masked); the customer gets a push.
  - **Task photos:** ≤ 5 when posting, private `task-photos` bucket (JPEG only, re-encoded in the browser so the location data inside the file is dropped). Rows are made when the upload slot is issued and attached on posting; unposted uploads are purged after a day by the tick. Visible to whoever can see the task.
  - **Care work:** no start / progress / task photos at all, and the handover photo note says never to photograph the child or the person cared for. (The handover photo itself is still required by the engine — open question below.)
- **2026-11-17 — talk before choosing; care work for individuals; distance for "other" and "accompany"** (owner: "allow the babysitting or the elder caring … approve them by additional security and safety, as well as direct communication like mandatory call"):
  - **Talk before choosing:** while a task is open, the customer and each live applicant have their own chat and in-app call (`/chat/<task>?with=<applicant>`; the DB already stored one conversation per (task, helper) with matching RLS, so no migration). Phones / links stay masked. After someone is chosen, other applicants' conversations become read-only for the customer.
  - **Care clearance (individuals):** a `helper_certificates` row for childcare / eldercare; only someone with the criminal-record check (kyc 4) can ask; Ops approves after a video interview and ≥ 2 references (shown as a reminder on /ops/certificates). Counts only while kyc stays 4. Agencies keep working as before (agency kind + kyc 4).
  - **Mandatory call:** a care task is assigned only to someone the customer has talked to on that task — an answered call ≥ 30 s in their conversation. Enforced in the task/job actions, the customer UI ("Сонгох" hidden until then) and the database (`deals_care_call` trigger). The server writes a call's length only for calls it relayed (an `answer` signal exists) and caps it by the time since that answer, so a browser can't fake one.
  - Care kinds remain **off** until Ops switches them on (Ops → Санал, хайлтын үгс).
  - **Distance:** "Бусад" and "Дагалдах" are two-place kinds now (pickup → destination, distance pricing, optional return leg at 50% of the distance part — `roundTripBps`).
  - Chat / call / price change only appeared after a helper was chosen and paid — working as designed then; the "not appearing" report led to the before-choosing chat above.
- **2026-11-16 — Specialized work** (continuation of the selected organisation model):
  - Add plumbing, electrical, cleaning, childcare and elder care. Plumbing/electrical/cleaning accept an approved organisation's active, consenting worker or an individual with an Ops-approved, unexpired certificate. Care is **disabled by default**, agency-only and requires the worker's checked criminal-record certificate (KYC 4). Ops must acknowledge legal review to enable each care category.
  - Customers always choose caregivers, including after a worker accepts their counter-price. No instant accept or automatic selection. The posting review asks a parent/responsible family member to attend the first visit.
  - Organisation jobs pay the **organisation**, including material reimbursement and cancellation fees. The payee is captured on the offer and assignment; bargaining cannot switch it, and paid jobs keep the same recipient even if a worker later leaves. An unpaid match returning to open clears the assignment payee. Independent certificate holders keep individual payouts.
  - Plumbing/electrical get a 72-hour check window. Pricing still uses the existing customer-set fee and service fee rules. Materials can be budgeted and reimbursed through the same held-payment flow.
  - Profile links to organisation registration, invitations/memberships and trade certificates. Organisation owners/managers manage workers and see the released company balance. Ops reviews registration documents, bank details and certificates; public helper/offer cards show the organisation and payment recipient.
  - Qualification checks cover posting, direct invitations, dispatch, nearby feed, helper directory, applicant ranking, offer insertion and assignment. Private documents stay in the KYC bucket with five-minute review links; all new data tables and credential lookups are server-only.
  - Two migrations: `20261117000000_specialized_categories.sql` then `20261117010000_organizations.sql`. Enum additions must commit before the schema uses them. Registering the organisation and its bank account is atomic. No real withdrawal adapter is added; company balances use the same payable ledger as helpers.

- **2026-11-16 — Direct requests + helper listings** (owner approved step 4: "less hardcode and more usage of backend and database"):
  - **Helper listing:** `profiles.bio` (≤ 500, phones/links/handles masked on save) and optional `profiles.from_price` (≥ today's base fee). Shown on the helper card and profile, next to **"typical price"** = the median fee of their last 30 released jobs (only with ≥ 3 jobs; computed from deals, not typed).
  - **Direct request:** "Хүсэлт илгээх" on a helper's profile opens the post flow at `/post?helper=<id>` (kinds limited to what they do; "Choose for me" off). The engine enforces it (`deal.invite`, `invitedOnly`): only that helper may apply while it stands. Customer chooses at posting:
    - *open to others if they can't* (default): exclusive for 15 min (Instant) / 3 h (booked later), never past the match deadline; then the normal waves start.
    - *only this helper*: exclusive for the task's whole life; if they decline, the task ends (`expired`; nothing is held while open).
    - Helper: "Боломжгүй" (`decline_invite`, no penalty). Customer: "Бүх туслагчдад нээх" (`open_to_all`).
  - **Safety nets:** the DB refuses an invite to anyone but an approved helper doing that kind of task (`private.check_invite`) or to yourself; `nearby_open_deals`, the "Бүх ажил" board, the public board and the job page hide the task from other helpers while it stands. Only the invited helper is pushed, once.
  - **From the database, not the code:** popular chips and the seasonal row are `quick_starts` (titles mn/en, months 1–12, order, on/off); "popular" is ranked by how often each title was posted in the last 30 days. The search words that guess the kind of task are `category_keywords` (prefix match; ≤ 2 letters = whole word; with a space = phrase). Ops edits both at **/ops/content** (logged). `popular.ts` and the `home.pop/sea/season` strings are gone.
  - Still in code on purpose: the six categories (engine rules depend on them), dispatch waves, invite windows (`EngineConfig`). Candidates for Ops settings later.
- **2026-11-16 — web (desktop) version + browsing both ways** (owner: "basically pleasehelp's homepage… more posts like Unegui so customers and helpers find each other by browsing"):
  - md+: `WebNav` top bar (logo · Хүсэлтүүд · Туслагчид · (helper: Ажил, Орлого) · Тусламж · "Хүсэлт бичих" · avatar); app column `max-w-2xl`; browse pages full width via `<Wide>` (69rem, aligned with the bar). Phones unchanged (bottom button / tabs hidden on md+).
  - Home = PleaseHelp-style: hero (greeting, big question, search, quick-start chips) + live tasks and recent requests beside it; 6 categories; seasonal row; open-requests grid; helper cards; recent reviews (≥4★ with a note, reviewer masked); money + past tasks.
  - `/requests`: all open requests, category + newest / best paid; real titles for signed-in users (the detail page already showed them; exact places stay hidden until matched); your own posts excluded. `/helpers`: directory of approved, non-suspended helpers (category; top rated (Bayesian) / most jobs / newest; ♥ saved tab).
  - Fixed: CSS grids without explicit columns stretched to their widest scrolling row on phones (Home was 425 px on a 390 px screen) → `grid-cols-1`.
  - Next (needs a DB change, ask first): helper intro text + "from" price on cards; "send this helper a request".
- **2026-11-16 — public info pages, seasonal row, search → category** (from the UBCab / Unegui / PleaseHelp references):
  - `/help`, `/safety`, `/privacy` are public (`(info)` route group, in `PUBLIC_PATHS`). Help text updated to today's flow (free posting, own price + bargaining, pay when chosen). Safety page lists only what the code really does. **Privacy policy is a draft** (marked on the page) describing actual data and retention — a lawyer must review it, and the owner must add company/contact details. No terms-of-service page yet (needs a lawyer).
  - Landing footer UBCab-style: columns + link cards to the three pages.
  - Seasonal quick starts (Unegui-style): winter (Nov–Mar, UB time) snow, car start, pharmacy, dry cleaning, groceries; warm season moving, windows, bicycle, yard. On Home and the landing page.
  - Search text → category (`guessCategory`, keyword stems, tested): "буйдан зөөх" opens posting at step 2 with "Зөөх · солих"; unsure → normal step 1.
- **2026-11-16 — open bargaining; we only set the minimum** (owner: "not reasonable for us to decide the price… bargaining is always open between the two"). Replaces the 2026-11-15 band (−20%…+30%, one counter ≤ +30%):
  - The customer names any price ≥ the minimum (5,000₮ by day, 6,000₮ at night, live Ops setting at posting). No recommended price is shown; `quoteFee` still runs and is stored as `details.quotedFee` (for learning later — "recommendation from past data" is optional/future). Category tiles show the minimum.
  - Per helper, back and forth with no limit: `apply` (take the price or name one) → customer `counter` → helper `reprice` / `accept_counter` … `offers.proposed_by` says whose price is on the table; the other side may accept it. The customer can't "choose" their own pending counter, and "Choose for me" skips those. The customer may `set_price` while open; helpers who already said yes keep the price they agreed to.
  - Service fee stays fixed at posting (flat tiers); the agreed price is what the helper keeps. Prices above the per-task safety cap are refused in the server actions.
  - Fixed on the way: offers were loaded **without their price**, so a helper's counter was silently lost (choosing them charged the posted price).
  - **Price change after matching** (matched / in progress): either side `propose_price`s, the other `answer_price`s (accept / decline) or proposes another. Lower → the difference is refunded from the hold at once. Higher → `awaiting_payment` until the customer pays the difference (`confirm_price`, provider webhook, idempotent by reference); it doesn't count before. An unpaid increase blocks "done"; an unanswered proposal lapses at "done"; cancelling clears it. Stored in `deals.price_change`.
  - Checked end-to-end in Chrome on the live database: post 7,000 → helper asks 9,000 → customer offers 8,000 → helper accepts → paid → helper proposes 10,000 → customer accepts → difference paid → held 10,500; ledger invariant clean.
- **2026-11-16 — price never jumps without a reason:** the owner saw "8,000₮" on a tile, then a much bigger amount on Continue. Causes found by walking the flow in Chrome: the Continue button showed the *total to hold* (fee + item budget + service fee), and a saved Home address silently added its floor (moving: stairs without a lift, 1,500₮/floor). Now the "where" step shows "Suggested price X = base + time + stairs…" live above a plain "Continue", with the item budget on its own line ("held, returned if unused"). Prices themselves were correct.
- **2026-11-16 — public "requests waiting for a helper" board** (landing, PleaseHelp-style; recruits helpers): open requests only, a **standard title per category** (never the customer's words — PleaseHelp's titles are generated too), no place or person; trip length, time + duration, items flag, "2 helpers" tag, helper's pay (engine split). Tapping → login → `/jobs/<id>`. Checked: a customer's own title does not appear in the public HTML.
- **Open (owner to decide): 2-person jobs.** Today a job that needs 2 people is priced for two but matches **one** helper, who gets the whole fee and brings a partner — the partner is **not verified** by us (safety gap). Options: recruit each helper separately (PleaseHelp "1/2 matched", per-person pay, split payouts — engine + DB change) or, short term, require the matched helper to add a second **verified** helper.
- **2026-11-16 — first real-browser check (headless Chrome, 390 px) found two old bugs:** (1) **maps never displayed** — MapLibre's unlayered CSS `.maplibregl-map{position:relative}` beat Tailwind 4's layered `absolute inset-0`, so the map box was 0 px tall; map containers now also carry `h-full w-full`. (2) `/jobs` scrolled sideways — `<fieldset>` defaults to `min-width: min-content`; `fieldset { min-width: 0 }` in globals. Screenshot/probe scripts live outside the repo (puppeteer-core + system Chrome, `--use-angle=swiftshader` for WebGL).
- **2026-11-16 — helper profiles, ♡ saved helpers, public reviews:**
  - `/helpers/[id]` (signed-in users; approved helpers only): display name, ✓ badges (kyc 3/4), ★ average + count, jobs done, member since, categories, area as typed, highlights (positive tags given ≥ 2×), last 20 reviews. **Never** phone, legal name, payout account or position.
  - Reviews = the existing customer ratings (stars, tags, note). Reviewer shown as first letter + `***`; notes trimmed to 300 chars with phones/links/handles masked (`maskContacts`). The rating sheet now says the review is public with the name hidden.
  - ♡ `saved_helpers` (migration `20261116020000`): own-list RLS, writes server-only, max 100, no saving yourself. `/helpers` lists them (Profile → "My helpers"). Applicant and matched-helper cards link to the profile.
  - Not yet: "request this helper again" (direct offer to one helper), customer mini-profile for helpers, two-way ratings.
- **2026-11-16 — landing page, login sheet, PleaseHelp-style patterns** (owner liked pleasehelp.co.kr; layouts borrowed, never their characters/colours/brand):
  - Logged-out `/` → `/welcome` (public): hero with search + popular starts, real "recent requests" (category, price, status, time only — no titles, places or people; `[verify]` test tasks hidden), categories with today's "from" price, 4 steps, "Why Tuslamj" cards (UBCab-style two-tone heading), become-a-helper, footer, fixed dark CTA bar. Stats band left out until the numbers are real. Company details in the footer: **owner to provide** (legal name, registration, contact).
  - Acting while logged out opens a login sheet → `/login?next=…`; `safeNext` allows only our own paths (tested). Deep links redirect to login with `next`.
  - Home: area pill with the real online-helper count, popular-task chips, recent requests. Helper job cards: tags, title, distance, time + duration, line, big orange fee.
  - Later (needs a DB change, ask first): helper profiles, ♡ saved helpers, reviews with masked names; portfolio from proof photos only with both sides' consent.
- **2026-11-16 — full redesign** (owner: "not the biggest fan of the current look"; picked from a researched preview, asked for smaller text): Onest font (fixed: Ө/Ү were rendering in a fallback font — the cyrillic-ext subset was never loaded), Lucide icons instead of emoji, borderless rounder cards on the grey page (the body had kept a white background class), task-first Home with the main button fixed at the bottom, posting split into 4 one-question steps, task screens as map + overlapping sheet. Layout and look only; logic, money and privacy unchanged.
- **2026-11-16 — visual style B:** owner picked "light grey + white cards + orange" from three previews (A white+orange, B, C dark buttons + orange accents). Tokens in `globals.css`; orange `#EA580C` for fills with large bold white text (AA large 3.6:1), deeper `#C2410C` for orange text and prices (≥ 4.7:1). Headline prices orange (owner's request); held money stays green; app icon orange.
- **2026-11-16 — CI, input validation, system health** (ideas taken from another team's CLAUDE.md):
  - **CI** (`.github/workflows/ci.yml`): every push runs type check (`next typegen && tsc`), all tests (incl. migrations in PGlite) and a production build with placeholder public env — no secrets in CI.
  - **zod at every server action that takes data** (`src/lib/input.ts`): server actions are public endpoints and TypeScript types aren't checked at runtime. Shape only; business rules stay in the engine. Closed a real gap: a proof `kind` became part of the storage path unchecked.
  - **System health:** `/ops` shows whether the background tick is running (stopped after 2 min of silence → red); `GET /api/health` returns 200/503 (`{ok}` only) for a free uptime monitor later.
  - Kept for later: AI output → zod + retry once → Ops review; numbers never from AI; a help bot answering only from our help pages with sources.
- **2026-11-16 — detail layout:** task (customer) and job (helper) screens moved from stacked cards to the "D Detail" layout in `docs/ui.md` — full-width map, tag + big title, divider sections (Fee | Items, When, Place and request, Timeline), grey address boxes with Copy / Directions, Call | Chat row. Layout only; logic, money and privacy unchanged (the helper still sees "exact address after matching" until chosen). Our colours and no illustrations.
- **2026-11-16 — ideas from the Haejuseyo screenshots:** route line on maps (helper → pickup → drop-off, straight dashed, not turn-by-turn); the job screen shows **Your fee | Items to buy** side by side (says "No purchase needed" outright); one "when" line with the duration ("Now · about 30 min"); new-job push is **price first** ("[7,500₮] title"), showing what the helper keeps; Copy buttons next to the exact addresses for the matched helper. Kept ours where safer: they let the helper pay for items and get a bank transfer later; we hold the item budget up front. Later: a saved-jobs list for helpers.
- **2026-11-16 — exact pins server-only before matching:** the ~300 m fuzz was applied only in the UI, while RLS let approved helpers (feed) and applicants `select` open deals — exact pin, pickup pin, address, entrance/floor/door — straight from the API. Since the app reads deals only in server code (service role), the deals policy is now **participants or admin only** (customer, matched helper, seller/buyer, Ops). Test: a helper's own token sees no open or applied-to task.
- **2026-11-16 — maps connected (pickup pin + measured distance), key-free:**
  - Two-point tasks (shop, deliver, carry) pin **both** places: a Pickup / Drop-off switch over one map; each map opens near the other pin, which shows as a fixed marker.
  - With both pins the **engine measures the distance** (`roadKm` = straight line × 1.3 road factor, 0.1 km) and ignores the client's number, so the price can't be gamed by a wrong km. No pickup pin (e.g. "any store nearby") → the rough 1/3/5/10 km chips as before. Over 100 km is refused.
  - Why no router or Google: always available, no third party, no key (owner's preference). The −20%…+30% price freedom absorbs the estimate. `roadKm` can later be swapped for OSRM/Valhalla (own server) or Google Routes without UI changes.
  - "Nearby" (dispatch waves, the nearby feed, the board, ranking, job-map chips) is measured from **where the helper starts**: the pickup if pinned, else the task pin (`helperStart`, same rule in SQL).
  - Helpers see the pickup as a ~300 m area before matching and the exact pin after; the trip distance shows on the job ("~3.4 km pickup → drop-off"); Google Maps directions use the pickup pin as the waypoint.
  - Not done (ask first): address search and address-from-pin (would send typed text/positions to a third party such as Photon/Nominatim), live helper ETA.
- Supabase chosen over Prisma (auth + storage + Postgres in one; RLS). Prisma removed.
- Mock OTP = Supabase Send SMS hook writing to a private outbox; dev screen shows the code (`DEV_SHOW_SMS_CODES`).
- Docs: DESIGN.md wins over UI-FLOWS.md on layout/navigation (3-tab floating bar, chat inside the deal, SafePay as a home tile, `46,000₮`).
- **2026-11-15 — hosting: Vercel** (free tier), Seoul region next to Supabase. Private test deployment first: **only `TEST_PHONES` can sign in** while there's no real SMS provider (otherwise on-screen codes would let anyone log in as anyone); payments stay mock; security headers on; dev gallery off. Steps and the before-real-users checklist: `docs/deploy.md`.
- **2026-11-15 — background scheduler:** Supabase's own **pg_cron + pg_net** call `/api/cron/tick` every 20 s (no outside service). The URL goes in `private.app_config` and the `CRON_SECRET` in **Supabase Vault**, both set at deploy time with `npm run scheduler:configure -- https://<domain>` (never in git); until then the job no-ops. A DB lease prevents overlapping ticks; `system_heartbeats` records the last success or error. Dev: `npm run cron:local`. **Open:** the app must be deployed at a public https address for production ticks (hosting not chosen yet).
- **2026-11-15 — fewer screens:**
  - No separate History or Wallet pages. Customers have one screen (Home): active tasks, a money card (held now / refunded) when there is any, and past tasks (3 shown, "Show all" expands in place) with "Order again". No tab bar for customers.
  - Helpers keep two tabs: Ажил · Орлого (finished jobs are already on Орлого).
  - SafePay's tile and placeholder page are hidden until SafePay is built (the engine stays).
- **2026-11-15 — pricing: build-up price, limited freedom, helpers keep 100%:**
  - **Research:**
    - Haejuseyo: the customer names the price above a 5,000 / 6,000 KRW day / night floor; the helper pays a 9.9–11.9% withdrawal fee.
    - inDrive: recommended fare, green/orange hint, drivers counter.
    - Airtasker / TaskRabbit: time × rate for unusual jobs.
    - Mongolia's minimum wage is 792,000₮/month (≈ 4,714₮/h), rising to 1,000,000₮ (≈ 5,952₮/h) on 2027-01-01.
    - UB delivery: CU ≈ 5,000₮, UBEats ≈ 10,000₮ (owner's estimate).
  - **Owner's choices:**
    - Breaking even is fine.
    - **No percentage cut from helpers:** "in Mongolia you rarely see places taking 10%". Instead the customer pays a small flat service fee shown upfront (500 / 1,000 / 2,000 / 3,000₮ by price step).
    - 10,000₮/h was too high. **Instead, a build-up price:** 5,000₮ base, plus a visible line for each extra effort (time, distance, heavy, stairs, tools, night, second person).
    - **Freedom, but limited:** the customer may move the price −20%…+30%. The +30% cap also blocks inflated "fake job" payments. Helpers accept it or counter once (≤ +30%) and never undercut, so there are no price wars.
  - Odd jobs need no special mode: the price comes from effort answers, not from recognising the job.
  - All numbers are live at `/ops/pricing`.
  - **To do:**
    - re-check the minimum before 2027 (minimum wage rises);
    - ask QPay / the bank their per-payment cost so the service fee covers it;
    - once there's data, nudge recommendations toward real agreed prices;
    - maybe a "cold day" switch (+20%).
- **2026-11-15 — safety pack, parts 1–2 (controls + SOS):**
  - **Controls (`/ops/safety`, one DB row `platform_controls`, changed without a deploy):** "pause new tasks" and "freeze money movements", plus caps: most held per task (300,000₮), most one customer pays in 24 h (600,000₮), most held platform-wide (5,000,000₮), active tasks per customer (3). Ops can change all of these.
  - **Enforced in the database:** a trigger refuses new deals while posting is paused, and a trigger on `ledger_entries` refuses every entry except `pay_in` while money is frozen (SQLSTATE `PT423`; the whole transition rolls back, so deals keep their state and due releases run after the freeze is lifted).
  - **Pay-ins are never refused at booking:** if the bank says money arrived we must record it. New payments are stopped earlier, before an invoice exists (`payin_check()`: freeze or a cap).
  - **SOS** (on the task / job screen while the two people may meet): tel: links to 102 / 103, and "Alert the Tuslamj team" with the phone's position. It works in any status. Each person has one live SOS per task (pressing again updates it). Ops is pushed at once and again every 2 min for 30 min until someone taps "I'm on it". **The other person is never told** (if they are the danger, telling them could make it worse).
  - **Report a problem** (kind + description, 5 an hour per person): goes to the Ops queue. Money questions stay in disputes.
  - **Ops** (`/ops` hub, `/ops/incidents`): SOS first, a tel: button to call the reporter (number not printed), map link, acknowledge / resolve with a note. Positions are deleted 30 days after resolution.
  - **Audit:** every control change and incident decision is written to the append-only `ops_audit_log` (KYC decisions to follow in part 4).
  - **Open:** nobody is on duty to answer an SOS yet. Before real users there must be a named Ops person with push on, and the copy must not promise a response time we can't keep.
- **2026-11-15 — helper verification:** helpers submit ID front/back, a selfie holding the ID, a criminal-record certificate ("ял шийтгэлгүй тодорхойлолт", e-Mongolia, ≤ 3 months) and a payout account in the same name; **Ops reviews by hand** (no ДАН integration yet; automatic face match deferred — no new keys). Documents in a private `kyc` bucket, opened only by server code / Ops via 5-minute links, **deleted 30 days after the decision** (we keep verified name, last 4 ID digits, decision and who/when). Full account numbers are server-only; profiles keep the last 4. Badges: "✓ Баталгаажсан" (kyc 3) and "✓ Ял шийтгэлгүй" (kyc 4). Selfie re-check before jobs: later, with a face-match model.
- **2026-11-18 — helper verification update (supersedes the record-check requirement above):** new applications require ID front/back, a selfie with ID, age 18+, and a same-name payout account. Ops reviews identity and payout details manually; criminal-record certificates are not collected, checked, or represented by a public badge. Public profiles say "ID reviewed" only after approval. Keep level 4, `record_path`, and old task requirements solely for historical compatibility and normal retention cleanup; do not make them available in new onboarding or task forms. Care work remains paused and requires a separate legal/product review before reconsideration.
- **2026-11-14 — chat & calls safety choices:** chat opens once a helper is chosen (not with applicants); contact details masked + sender warned + flagged for Ops; calls: direct WebRTC now, **own coturn relay (relay-only) before real users** so calls connect on mobile CGNAT and nobody sees the other's IP, voice-message fallback if a call fails; chats kept 90 days after the task ends (disputed kept until resolved). No call recording.
- **2026-11-14 — reference review** (offfahad/uber-clone [Flutter+Firebase], Autofleet/locomotion [RN rider app], phongna07 + sanidhyy messenger clones; blinks32 has no source, only screenshots and a sales README):
  - **Validated:** server-side state machine; polling is fine for now (Locomotion polls every 4 s); the chat model is conversation → messages, with seen and image fields.
  - **Mistakes to avoid** (all found in those repos):
    - secrets in the app (a Google service-account key and a Stripe secret key in the Flutter client);
    - floating-point fares;
    - dispatch driven by the rider's phone (it stops if the app closes);
    - payment confirmed by the client;
    - chat rooms with no membership check (anyone with the ID can read or listen).
  - **Worth adopting:**
    - customer limits (max active tasks; no new task while something is unpaid);
    - cancellation reasons;
    - tips;
    - a helper document-upload onboarding (ID, selfie);
    - "N helpers nearby" on Home (counts only, for privacy);
    - route-based distance (open-source OSRM/Valhalla, or Google if a key is ever added);
    - a Capacitor wrapper later for background location and native push (key-free, reuses this web app).
- **2026-11-14 — no new third-party keys:** calls become browser **WebRTC peer-to-peer** with Supabase Realtime for setup (no LiveKit account); chat uses Supabase; AI proof checks are deferred. This supersedes "LiveKit Cloud" below.
- **2026-11-13 — research pass (Haejuseyo, TaskRabbit, UBCab) → direction:** pay when matched, held by the bank (not at posting, not at the end — no card-on-file in MN, helpers would carry the risk) · UBCab-style waves, first to accept wins, close *and* good ranked first · matched posts leave all feeds (multi-person "keep recruiting" later) · chat + voice/video calls inside the deal via **LiveKit Cloud** (self-host later) · two-way ratings · photo/video proof checked by a **hosted vision API + open-source PaddleOCR** for receipts (flags only; Ops decides) · maps: **MapLibre + OpenFreeMap tiles** (open source, no key), pin-first addresses.
- **2026-11-13 — maps on both sides:** in-app maps are MapLibre on OpenFreeMap tiles (Home: my position + active tasks; customer task: task pin + the helper's live position during the job; helper Jobs tab: open tasks as price chips; helper job: map + "Google Maps-аар чиглэл авах"). Turn-by-turn navigation hands off to **Google Maps' own app** via its public Maps URLs (no API key; pickup becomes a waypoint). Privacy: before a helper is matched they see only a ~300 m area (`fuzz`) and no street address; the helper's live position is sent every ~30 s only while matched/working and shown only to that task's customer.
- **2026-11-13 — the customer chooses:** helpers are notified (waves) and send requests; the customer picks from live applicants (best marked "Recommended"); optional "Choose for me" auto-picks the top applicant 3 min after the first request. Limits: 3 open requests per helper, Instant requests lapse after 15 min, a paid helper's other requests auto-withdraw. Instant tasks keep the system price (no haggling); quotes only on Custom tasks.
- **2026-11-13 — saved addresses:** saved while posting ("Энэ хаягийг хадгалах: Гэр / Ажил / Бусад"), one Home + one Work + up to 5 others; one-tap chips above the address; fills entrance / floor / unit / lift / note; Home pre-fills a new task; remove in Profile. Table `saved_addresses`, owner-only RLS (helpers never read it — the task keeps its own copy).
- **2026-11-13 — templates = "Дахин захиалах":** a button on finished tasks (History → Дууссан, task screen) opens the post flow at Review with everything filled in; the price is recalculated for now. No named templates (can be added later in their own table).
- **2026-11-13 — round trip:** +50% of the distance part (see rules.md "As implemented").
- **2026-11-13 — receipt over budget:** customer approves and pays the difference as a second held payment, or declines and the helper returns the items and keeps the task fee; optional +10% buffer at posting avoids the question for small overruns (rules.md "As implemented").

## Waiting on a decision
- **AI proof checks:** deferred. The owner prefers no new keys: either a hosted vision API later (key in `.env.local`) or open-source models on our own server.
- **Background scheduler:** who calls `/api/cron/tick` in production (Supabase pg_cron + pg_net every 15–30 s is the default plan).
- **Multi-person jobs:** "keep recruiting" for 2+ helpers needs split payouts per helper.
- **Address search:** written addresses and saved/recent suggestions, with optional confirmed map pins; public place search (Nominatim / paid geocoder) remains deferred.
- **Unanswered top-up:** should a pending over-budget request expire (e.g. after 30 min → treat as declined)? Today it waits; the helper can drop items instead.

## 2026-11-24 — Lower starting prices
Owner: day jobs (түр ажил) at least 4,000₮ an hour; most errands should start at 3–4k because it depends on the kind, the distance and how easy it is. Rule of thumb now: ~4,000₮ per hour of expected work, 3,000₮ for quick (~30 min) jobs, a bit more for heavy work or tools. General minimum 4,000₮ (queue, other); trash/shop/deliver 3,000₮; repair 4,000₮; assembly 5,000₮; carry 6,000₮ (stairs still added per floor); escort 8,000₮ (~2 h); day jobs 4,000₮/h. Plumbing, electrical, cleaning and care unchanged. Floors only — the trip, night extra, stairs and "raise the price?" nudge still apply; all editable at /ops/pricing (migration 20261124010000).
Open: Mongolia's minimum wage is 792,000₮/month (≈4,714₮/h) and is set to rise to ~1,000,000₮ from 2027. Helpers are contractors, but a day-job floor below the hourly minimum wage is the one place a labour inspector could point at; → owner agreed: day jobs 5,000₮/h (migration 20261124020000); raise to ~6,000₮/h when the 2027 minimum wage starts.

## 2026-11-24 — Tabs for customers, shorter Home
Owner agreed: customers get a bottom bar too — **Нүүр · Захиалах (orange) · Даалгавар · Профайл**; helpers **Ажил · Орлого · Профайл** (replaces 2026-11-15 "Fewer screens": past tasks and the profile were hard to find). The new Tasks tab holds live tasks, money held / refunded and the latest 50 past tasks with "Order again". Home on phones is now just: to-dos → greeting, search, quick starts, live tasks → categories → seasonal → trust line; open requests, helpers, their work and reviews show on the website only. Helper Jobs order: the job you're doing → offers waiting for you → to-dos → online switch → your applications → the feed → "add new kinds".

## 2026-11-24 — Account and navigation consistency fixes
The home-mode cookie is tied to the verified user ID, ignored for other users and removed on
sign-out/account closure. A legacy unowned cookie defaults to customer mode once; Profile can
select worker mode again. Mode remains a UI preference, never an authorization signal.
Direct job/earnings links show worker navigation and customer task/post links show customer
navigation. Workers can open their commissioned tasks; returning through the Home tab selects
customer mode explicitly. No preference is written during link prefetching.

All active customer tasks and worker jobs are read separately from recent closed history, including multiple
pages of unresolved tasks. A failed read propagates instead of showing an incomplete held total.
Worker category prompts are scoped per account and failed saves remain retryable.

## 2026-11-25 — Landing trust: prices on work photos, numbers band, company details
After studying PleaseHelp (site-study skill), owner: "then do those". Their "requests right now" board we already had (no place shown at all — stricter than their district).
- **Work photos show the job's final price** (the agreed fee after any change or partial refund; never the shopping). Only for photos agreed under the new wording that says so (`work_photos.show_price`); photos agreed earlier were promised "only the kind of job is shown" and keep that promise.
- **Numbers band** on the landing page: finished jobs, approved helpers, average rating + number of customer reviews (`public_stats()`). Real totals only; each number appears once it passes a floor (100 jobs, 20 helpers, 30 reviews — `STATS_FLOOR`), and the band needs at least two. "[verify]" tasks never count.
- **Company details in the footer** (name, registration number, address, plus support phone/email), filled in by Ops at /ops/support; empty = hidden. Migration 20261125010000.

## 2026-11-25 — Mongolia research → safety and helper changes
Owner: "lets start then. anything we can include and should include" (after the PleaseHelp helper videos and the Mongolia research).
- **Day jobs ≥ 6,000₮/h** (migration 20261125020000): the minimum wage becomes 1,000,000₮/month and 5,952.30₮/hour on 2027-01-01 (tripartite decision of 2026-08-17).
- **Paying outside the app** (online fraud: 12,233 cases and about 694 billion₮ lost in 2025):
  - A chat message that talks about transfers, bank accounts or cash is flagged (`mentionsOffAppPayment`), unless the task is an older pay-the-helper-directly one.
  - The reader sees a warning under that message; the sender sees a reminder.
  - The chat screen now has "Report a problem" (and SOS) for the two people on the task.
  - Phone numbers, links, handles and long digit runs (bank accounts) were already hidden.
- **Ops can pause an account** from an incident, for 7 or 30 days, with a reason; it is audited and can be lifted. A paused helper gets no new jobs; a paused customer can't post. Running tasks finish normally. The chat's safety line now says both accounts can be suspended. A matching terms clause is an open question for the lawyer (docs/advisor-questions.md).
- **Helper Jobs screen:**
  - an online pill in the header that jumps to the online card;
  - Now / Scheduled filter chips on "All jobs";
  - "closes in …" on Now jobs;
  - **slide to finish** (`SlideSubmit`): a tap does nothing, the keyboard still works.
- **Kept as is:** the customer chooses the helper (trust, given how common fraud is); the applicant cap already exists (`maxApplicants`, 5). Not copied from PleaseHelp: "no cancelling after a match", claims that chats are monitored, and dress/behaviour orders (they read like an employer's).

## 2026-11-25 — Recommending a helper; PleaseHelp layout
Owner: "customer should be the one to choose. probably the closest one they should actually recommend, with other better rated ones then coming up after". Chose "depends on job" and "their layout, our look" ("references and diagrams/lines", not their colours).
- **The customer always chooses.** The best-ranked applicant is marked "Recommended", with a "why" line next to it (closest · best rated · most jobs done). Tabs let the customer sort: Recommended · Closest · Best rated.
- **What "best" means depends on the job** (`rankProfile`, `RANK_WEIGHTS`):
  - **Now**, for a quick errand needed right away: distance 60, rating 20, reliability 10, experience 10.
  - **Planned**, for anything booked for later or done in a home or with a person (repair, assembly, cleaning, plumbing, electrical, escort, care): distance 25, rating 40, reliability 15, experience 20.
  - Dispatch waves use the same weights.
  - The standards penalty and the 4.5★ rating prior are unchanged.
- **Layout from PleaseHelp, in our colours:**
  - one `SectionHeader` everywhere: title, grey line under it, "See all →" on the right;
  - a reviews row on the landing page (4★ and up with a note, photo reviews first);
  - the helper's job screen shows Pay · Shopping · When as one card of label/value rows split by thin lines (`DetailRows`).

## 2026-11-26 — More from PleaseHelp's app screens (profile, home, request form)
The owner sent screenshots of PleaseHelp's profile, home, request form and subcategory list. Same rule as before: their layout, our look.
- **Built:**
  - **Trips drawn as a route** (`RouteStops`): pickup (dark ring) and drop-off (brand pin) joined by a line. Used in the post form, where both stops now share one card, and on the customer task and helper job pages. This replaces the "●" / "↘" text marks.
  - **One-tap notes for the helper** under the address note: leave at the door · leave with the building guard (жижүүр) · call me in the app first · entrance code by chat. The note is shown only to the chosen helper.
  - **Profile:** an avatar beside the name, and a "Become a helper" banner for customers who have never applied.
- **Already had:** a customer/helper mode switch, saved helpers ("My helpers"), job types, buying for the customer, scheduling, inviting a specific helper, a suggested price, a condition checklist, a floating tab bar with the main action in the middle.
- **Not copied:**
  - the prepaid credit balance (we never hold customer money as a balance; see the money model);
  - an "allow price offers" switch (bargaining is always open);
  - their 3D character art (we use Lucide icons; our own illustrations would be a separate brand decision).
- **Second batch** (their helper profile, portfolio, reviews and the moving form):
  - The helper profile's bottom bar is one row: a heart (save) next to "Send a request", instead of two full-width buttons.
  - Saved and recent places show as one-tap chips under each address box; the full list stays under "Saved".
  - Reporting a work photo is a small grey flag, not a bold "Report" that competes with the card.
  - Already had: stats row (rating · jobs · joined), review tags with counts ("on time · 12"), work photos with the price when the customer agreed, reviews with photos, one or two helpers.
  - Not copied: gender and age on the profile (an open question for the lawyer); reviews of customers shown publicly; a separate portfolio-post page (the helper's profile already holds the photos).
- **Open:** extra stops on one trip; a helper "has a car" field the customer can ask for (carry/deliver); "is there parking for the helper?" on carry jobs (UB apartment yards); per-category tap-to-fill phrases for the description; more job types per category (they list about 10 under delivery; we have 2).

## 2026-11-26 — Code and design review against current practice
Owner: "whatever bug or mistake, inconsistency — fix. and research more recent and modern professional coding practices". Checked against the Next.js 16 docs bundled in node_modules, the React 19 / Tailwind 4 guidance and WCAG 2.2.
- **Already current:** Next 16.4 with `proxy.ts` and the React Compiler, React 19.3 with `useActionState`, Zod 4, Tailwind 4 tokens in `@theme`, `next/font`, security headers, server-only data access. `npm audit` (production): 0 vulnerabilities. Every server action checks the signed-in user itself; the six that don't are public on purpose (sign-in, sign-out, language, the recipient's private link, the component gallery's no-op).
- **Fixed:**
  - One **type scale** (14 named sizes) replaced 25 hand-picked font sizes and Tailwind's own sizes (≈830 class names); radii and the map colours became tokens too. `design-tokens.test.ts` keeps it that way.
  - **Every page has its own browser-tab title** ("Profile · Guigere"); task, job and chat pages use a generic title so a private task title never lands in browser history.
  - **Root `error.tsx`, `global-error.tsx`, `not-found.tsx`** (translated 404), **`robots.ts` and `sitemap.ts`**: only production is indexed, and only the landing and info pages.
  - **Accessibility lint:** the full `jsx-a11y` recommended set is on (Next enables 6 rules); the few exceptions (live-call media, the login code autofocus, dialog backdrops) carry a written reason.
  - **Call panel:** the Realtime handler and the leave-page hang-up use `useEffectEvent` (React 19.2) instead of switching off the dependency rule.
  - The map's place search used Google's greys; it now uses ours.
- **Later, on purpose:**
  - Cache Components (`'use cache'`, Next 16's caching model): our pages are per-user and live, so the gain is small and the migration touches every data read.
  - A full nonce-based Content-Security-Policy: start with `Content-Security-Policy-Report-Only` and a report endpoint, because maps (workers, blob:), Supabase Realtime and calls need careful allow-lists.
  - Major upgrades (TypeScript 7, lucide-react 1.x, web-push 4): each one on its own branch with the full test suite.
  - SMS code lifetime and resend limits are set in the Supabase dashboard (Auth → Phone), not in `supabase/config.toml`; keep the lifetime at 5 minutes or less.

## 2026-11-26 — Honest placeholders instead of hidden sections
Owner, looking at production: "it looks way uglier … utterly washed down". Nothing had been removed: production has almost no real activity, so the data sections (open requests, helpers, finished-work photos, reviews) hid themselves, while preview links built against staging were full of test data. Owner chose "honest placeholders": each section keeps its place and, with no real data, shows `SectionPlaceholder` (dashed card, icon, one sentence on what will appear there, a next step where it helps). Never sample data; the real cards replace it automatically. Wording stays neutral about ID checks because the private helper test may run without them. The numbers band still waits for its floors (100 jobs, 20 helpers, 30 reviews) and the footer for company details at /ops/support.
