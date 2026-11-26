# Rules: deals, money, states, data

## Roles
Customer (post, pay, choose, confirm/dispute, rate, SafePay) · Helper (needs approval; feed, accept/quote, proof, payout) · Ops (approve helpers, decide disputes, ledger). One app, mode switch in avatar menu.

## Modes
- **Instant**: standard low-risk tasks (shop, pickup, queue, light carry). System price shown upfront (customer may raise). Sent to eligible + available helpers; first to accept wins.
- **Custom**: heavy/unclear/repairs or any "unknown" answer. Up to 5 quotes (price, arrival window, equipment); customer picks, then pays.
- Timing (now / later) is a separate field.

## Eligibility before matching
Filter out helpers who: aren't approved, are offline/unavailable, lack the category, lack required people/vehicle/equipment, or exceed travel time. Then: nearest by **travel time** → first to accept. No weighted scoring until ~200 completed jobs.
Carry rule: heavy item + no lift + floor > 2 → 2 people. Vehicle needed → car-owning helpers only.

## Fees (configurable; live in `pricing_settings`, /ops/pricing) — see "Pricing" under As implemented
**Minimum per task (2026-11-17):** `taskMinFee(kind, details, time)` = the kind's own minimum (`category_settings.min_fee`) or hourly floor × hours (`min_hourly`), plus the trip (km beyond the included, and the way back), plus night; ×2 labour for two people. Saved on the task at posting (`details.minFee`) and used for every later price.
Build-up price: base 5,000 (≈30 min, 1 km) + 3,000 per extra 30 min + 1,500 per extra km + heavy 3,000 + stairs without lift 1,500/floor above the 1st + tools 2,000 + night (22:00–07:00) 1,000 + round trip 50% of the distance part; 2nd person = labour (base, time, heavy, stairs) again. Rounded to 500.
The customer names any price at or above it (bargaining, 2026-11-16). Helpers keep 100% (commission 0). Customer pays a service fee of 10% of the price (rounded to 100₮, 500–5,000₮, nothing on the shopping budget; `serviceFeeFor`, Ops `service_fee_bps/min/max`, 2026-11-22). With the share at 0 the older flat steps apply on the job total: 1,000 under 10,000 · 1,500 under 30,000 · 2,000 under 60,000 · 3,000 above (SafePay buyers always use the steps). CANCEL_FEE 3,000 · CHECK 24 h (SafePay 24 h or 3 days) · MAX_OFFERS 5.

## Money split on errand release
```
spent      = min(receipt, itemBudget)
commission = round(fee * COMMISSION)
helperNet  = fee - commission + spent
refund     = itemBudget - spent
platform   = SERVICE_FEE + commission
held       = itemBudget + fee + SERVICE_FEE      // helperNet + refund + platform == held
```
Example (older deals, 10% commission): fee 40,000, budget 5,000, receipt 3,250 → helper 39,250 · refund 1,750 · platform 5,000 · held 46,000.
Deals posted since 2026-11-15 snapshot `commissionBps = 0`, so commission is 0, helperNet = fee + spent and platform = the flat service fee.
SafePay: buyer pays price + buyerFee; seller gets price.

## Cancellation / refunds
Before match: free. After match, before start: CANCEL_FEE to helper, rest refunded. Helper backs out (any time before `check`): full refund, the task is **open again** (fresh match window, helpers notified anew); free within 10 min of being chosen (`assignedAt`, `backOutGraceMinutes`), later an escalating pause (1st in 30 days 1 day, 2nd 3, then 7 + Ops alert; `helper_penalties`, decided in `apply_transition` v7). No match by deadline: auto full refund. Receipt over budget needs customer approval.

## States
```
errand: awaiting_payment → open → matched → in_progress → check → released
        open → cancelled | expired(refund)   matched → cancelled(fee)
        check → disputed → released | refunded | split
goods:  awaiting_payment → held → handed_over → check → released | disputed
```
check → released on customer confirm OR when checkUntil passes (cron, exactly once).

## Proof
Before "done": receipt photo + amount (if budget > 0), handover photo with time + GPS. Helpers can't finish without required proof.
Start: a start photo is required to start (care work excepted). While in progress: optional progress photos with a short note (≤ 20). Posting: up to 5 task photos (private `task-photos` bucket, attached on posting, unposted ones purged after 1 day). No photos of any kind on care tasks except the handover (never of the person).

## KYC
L1 phone OTP (small tasks) · L2 ДАН login (SafePay, larger) · L3 helper: ДАН + selfie vs ID + same-name payout account + 18+ + Ops approval · L4 trusted (home-entry, high value) later. ДАН is mocked behind an interface.
Payouts only to an account in the helper's own ДАН name.

## Anti-scam
Chat masks 8-digit / +976 numbers and warns on cash/transfer phrases (бэлэн, данс, шилжүүл). SafePay opens only by in-app code/link; show seller trust card. Banned: alcohol/tobacco for others, medicines, rides, childcare, entering homes alone.

## PaymentProvider
```ts
interface PaymentProvider {
  createInvoice(dealId: string, amount: number): Promise<{ invoiceId: string; qrText: string }>;
  release(dealId: string, payouts: { to: AccountRef; amount: number }[]): Promise<void>;
  refund(dealId: string, amount: number, to: AccountRef): Promise<void>;
}
```
MockProvider → QPayProvider + bank adapter later. Double-entry ledger.

## Data model
```
User(id,name,phone,role,kycLevel,helperStatus,rating,completedCount,categories[],equipment[],teamSize,payoutAccount,availableUntil,radiusKm,minFee)
Deal(id,type,status,mode[instant|custom],title,description,category,scheduledAt,pickup,dropoff,stops[],entrance,floor,unit,lift,addressNote,
     peopleNeeded,vehicleNeeded,itemBudget,fee,price,buyerFee,inspectHours,customerId,helperId,sellerId,buyerId,code,heldAmount,receiptAmount,checkUntil,createdAt)
Offer(id,dealId,helperId,price,arrivalWindow,note) · Proof(id,dealId,kind,fileUrl,amount,lat,lng,takenAt)
Photo(id,dealId,url,aiDraft json,deleteAfter) · Message(id,dealId,from,text,isSystem)
Dispute(id,dealId,openedBy,reason,note,outcome,decidedBy) · LedgerEntry(id,dealId,kind,amount,from,to,providerRef)
Rating(id,dealId,from,to,stars,tags[]) · TimelineEvent(id,dealId,text,createdAt) · Template(id,userId,dealSnapshot)
```

## Tests (must exist)
Split sums to held on every path · no double release · illegal transitions rejected · auto-release fires once · refunds return full amounts · webhook replay is a no-op.

## As implemented (keep in sync with `src/lib/engine`)

- **Bank verification (2026-11-22):** IBAN checksums validate syntax, not ownership. A typed
  name or approved ID cannot automatically set `payout_accounts.verified_at`. Ops records
  independent bank ownership evidence against an unchanged account snapshot. Manual payout
  decisions require a bank transaction reference. There is no automatic bank-transfer adapter;
  historical verification flags must be rechecked before one is enabled.

- **Earnings presentation (2026-11-22):** only ledger `payable` is ready to request; `payout`
  means a transfer has been requested, not sent. Recent job fees exclude direct-pay and
  organisation-payee jobs from personal pending amounts. Active work, completion review,
  overdue review and disputes are distinct; an elapsed review deadline never proves release.
  Automatic payout age uses live settings and means automatic request, not automatic transfer.
  No changes to financial transitions or accepted legal versions accompany this UI update.


- **Worker location (2026-11-20):** dispatch presence and customer sharing are separate. An assigned
  helper explicitly enables sharing for an `in_progress` task. The signed-in app layout samples every
  15 seconds while sharing, including on chat screens; online-only presence updates every minute.
  Customers see only their own task's current assigned helper, and coordinates expire after 90
  seconds even if refreshes fail. Stopping, finishing or changing helper deletes sharing; updates
  cannot recreate it. Foreground web tracking pauses when the app is hidden or the screen is locked.
- **Tracking recovery (2026-11-21):** reject stale or invalid browser samples before going online
  or requesting sharing. A successful consent change immediately updates its control even if a
  subsequent read fails; retry is available after permission or connection failures. Readiness
  failures return a visible error. Going offline does not require working GPS, push or approval;
  an already-online helper retains the availability control when device permissions fail.
- **Scheduler health (2026-11-21):** healthy means a valid, recent successful heartbeat for the
  latest run. Missing success or future timestamps cannot pass. Failed heartbeat writes and lease
  releases fail the request; malformed multibyte credentials return 401 instead of throwing.
- **Errand lifecycle (2026-11-13, supersedes "pay at posting" above):** post free → `open` (dispatched to helpers, nothing held) → helpers `apply` ("Хийж чадна"; Instant = set price, Custom = optional `price` quote) → the customer `choose`s one — or, with "Choose for me" (`details.autoPick`), the system picks the best-ranked applicant 3 min after the first application → `awaiting_payment` with `payBy` = +10 min → provider webhook `confirm_payment` → `matched` (held) → `in_progress` → `check` → `released`. A match not paid in time (`expire`) goes back to `open` (event `payment_timeout`; the chosen offer is dropped and `fee` resets to `postedFee`), or `expired` if the match deadline passed too. Before payment the helper may withdraw without a penalty (`helper_withdrew`, back to `open`); the customer may cancel `open`/`awaiting_payment` for free. Legacy deals paid at posting still work (accept → `matched`, cancel/expire refund).
- **Applications:** max 5 per task (dispatch stops once full); Instant applications lapse after 15 min; a helper may hold at most 3 open applications (server check, `MAX_PENDING_APPLICATIONS`) and can take one back (`withdraw_offer`); once a helper is paid for one task, their other applications are withdrawn and any other unpaid match is released (`releaseOtherCommitments`). Applicants are shown best-first with the dispatch score; the top one is "Санал болгосон". `accept` (first-to-accept) stays in the engine for legacy/urgent use but the app no longer offers it.
- **Extra rules:** night minimum fee 6,000 (22:00–07:00 UB time) · no helper by `matchBy` (30 min for Now, the scheduled time otherwise) → `expired`, nothing charged · title ≤ 40, description ≤ 500 chars · task pin must be inside Mongolia.
- **Instant price:** `quoteFee(category, details)` = category base + distance + add-ons (carry without lift: +1,500 per floor above the 1st; 2nd person +15,000; round trip "Буцаж ирэх": +50% of the distance part, rounded to 500, only when there is a distance). `createErrand` rejects a fee below the quote — customers can only raise it.
- **Buy-for-me budget buffer:** optional "up to 10% over" switch → the deal holds budget + 10% (`heldItemBudget`); unused money comes back at release like any unspent budget.
- **Receipt over budget (top-up):** `record_receipt` above `itemBudget` sets `topUp = pending` (event `topup_requested`); the helper can't finish while it is pending. The customer either pays the difference — provider webhook `confirm_topup` (idempotent on its own `providerRef`) moves it into the hold and raises `itemBudget`, so the helper is reimbursed the full receipt — or `decline_topup`: the receipt is cleared, the helper returns the items and finishes without one, earning only the task fee. A new receipt within budget replaces a pending request (helper dropped items). Only while `in_progress`. Helper cancel after a paid top-up refunds both payments. DB: `deals.top_up` jsonb; `apply_transition()` writes `item_budget` + `top_up`.
- **Carry eligibility:** heavy + lift not "yes" + floor > 2 → 2 people required (engine rejects 1).
- **Extra transitions** beyond the diagram above: `awaiting_payment → expired | cancelled` · `matched | in_progress → open` (helper backs out: full refund, posted anew; late = escalating pause) · goods `held → cancelled` (seller cancels before handover: full refund). The DB trigger `deal_status_allowed()` mirrors this list.
- **Not built yet:** Custom mode (quotes, pay on choosing) — engine still has `now` (first-to-accept) and `schedule` (applicants, paid upfront); Ops `split`; a time limit on an unanswered top-up (today the helper waits or drops items).
- **Dispatch (UBCab-style, `src/lib/dispatch/`):** helpers go online with a radius (1/3/5/10 km, district ≈ 15, city 60) and send their position about once a minute while online (`helper_presence`; stale after 10 min). An `open` task goes out in waves: ≤5 best within 2 km (45 s) → ≤10 within 5 km (45 s) → ≤25 within 10 km (60 s) → everyone left city-wide; an empty wave widens at once; a helper is never offered the same task twice and only within their own radius. Rank = 55% distance + 25% rating (Bayesian, prior 4.5★×5) + 10% reliability (offers won / received, 30 days) + 10% experience. Offers are pushed (Web Push) with the exclusive window; anyone eligible may still take it from the nearby feed. When the task leaves `open`, the winner's offer is `won` and the rest `closed` — the post disappears from every feed. **Board ("Бүх ажил"):** besides "near me", any helper (approved or not) can browse every open post in the city — all categories, no radius — filtered by category and sorted nearest / newest / best paid; taking a task still needs an approved helper in that category. Triggers: posting, the customer's searching screen (every 10 s), and `GET /api/cron/tick` (Bearer `CRON_SECRET`; also settles due expiries / auto-releases). Distance is haversine in SQL (`dispatch_candidates`, `nearby_open_deals`); PostGIS can replace it.
- **Proof (2026-11-14):** the assigned helper, while `in_progress`, uploads a receipt photo with its total (`record_receipt`, only if there is an item budget) and a handover photo **or short video** (`record_handover`); then `finish`. Files go to the **private** `proofs` bucket via a signed upload URL the server issues after checking the helper (`prepareProof` → browser `uploadToSignedUrl` → `submitProof`); viewing uses 1-hour signed URLs, for the deal's participants only. Photos are downscaled to 1600 px JPEG in the browser. Each proof stores sha256 + a 64-bit perceptual dHash, the helper's position and the file time; flags `reused_photo` (same file on another task), `similar_photo` (dHash ≤ 6 bits) and `old_file` (> 6 h) are shown to the customer as warnings — never blocking. `proofs.ai` is reserved for receipt OCR (PaddleOCR) and vision-model verdicts.
- **Chat (2026-11-14):** one conversation per (task, helper) — `messages.helper_id`; a helper released before payment keeps read-only access to *their* messages, the next helper starts fresh. Opens when a helper is chosen (`awaiting_payment`) and stays writable through `check`/`disputed` + 24 h after the task ends, then read-only; applicants can't chat. Ops reads a chat only while the task is disputed. Clients only read (RLS: own conversation); sending goes through `sendChat` → `storeMessage`: trimmed, ≤ 1000 chars, ≤ 20 messages/min, **phone numbers (8-digit MN mobiles, +976, 9+ digits), e-mails, links and messenger handles are masked** (`maskContacts`; prices/dates/door codes kept) and flagged `contact_masked` for Ops; the sender is told why. Photos: private `chat` bucket (JPEG ≤ 10 MB, signed upload/read). Live via Supabase Realtime (RLS-filtered) plus an 8 s poll fallback. Push says "new message from X" without content (lock-screen privacy). Retention: deleted with photos 90 days after the task ends (`purgeExpiredChats` in the cron tick); disputed tasks keep theirs. Known limit: spelled-out numbers can't be masked.
- **Calls & voice messages (2026-11-15):** voice or video calls between the task's customer and chosen helper while the task is `awaiting_payment` / `matched` / `in_progress` / `check` (not open, disputed or ended). Browser WebRTC; the handshake (offer / answer / decline / hangup / busy, complete SDP — no trickle ICE) goes through `call_signals` via server actions (access checked, SDP ≤ 20 KB and must look like SDP, ≤ 4 new calls per minute) and reaches the other side by Realtime (RLS: only the two people on the call) with a 2 s poll backup; a push with `/chat/<id>?call=<callId>` rings a closed app. Ringing stops after 45 s → "missed". **No recording**; one call-log line per call goes into the chat (`call:missed|declined|failed|ended:<video|voice>[:seconds]`, rendered per language). Signals hold network addresses, so the cron tick deletes them after 1 h. ICE: public STUN (Cloudflare, Google); with `TURN_URLS` + `TURN_SECRET` set, our own coturn relay with short-lived HMAC credentials and `iceTransportPolicy: "relay"`, so no IP is exposed. If a call can't connect, the app offers a **voice message** (≤ 2 min, private chat bucket, `messages.audio_path`). Until the relay exists, direct calls reveal each side's IP to the other and may fail on mobile CGNAT.
- **Helper verification (current):** `/helper/apply` — legal name, birth date (18+), last 4 ID digits, ID front/back and selfie with ID (photos ≤ 10 MB; uploaded by signed URL into `kyc/<userId>/…`), categories, same-name payout bank + account, and explicit consent. Criminal-record certificates are not collected or checked. Everything is re-validated on the server; files must exist in the applicant's own folder; one open application per person (DB unique index). `helper_applications` and `payout_accounts` have **no client grants at all**. Ops (`/ops/helpers`, admins only) sees documents via 5-minute signed links and manually reviews identity and payout details, then approve (`helper_status` approved, `verified_name`, categories, `kyc_level` 3, payout last 4; account `verified_at`) / ask for changes / reject (note required); the applicant gets a push. The cron tick deletes ID files and birth date 30 days after the decision. Legacy `record_path`, level-4 state and old task requirements remain for historical compatibility; they are not part of new applications.
- **Background jobs (2026-11-27):** `runTick()` (`lib/tick.ts`) runs due commands (payment lapse, no-helper expiry, auto-release and unanswered partial-refund offers), dispatch waves and auto-pick, then retention (signals 1 h, KYC files 30 d, chats per Ops settings), each step isolated. Failed steps and dispatches are reported after the remaining work finishes; the request fails and records an unhealthy heartbeat instead of refreshing `last_ok_at`. `GET /api/cron/tick` (Bearer `CRON_SECRET`, constant-time compare) wraps it in a 120 s DB lease (`try_lease` / `release_lease`; overlapping calls return `skipped`) and writes a `system_heartbeats` row. Callers: pg_cron every 20 s in production (`private.cron_tick()` → `net.http_get`, URL + Vault secret via `configure_scheduler`; `scheduler_status()` shows config and recent runs without secrets), `npm run cron:local` in dev, plus the lazy triggers on screens. Chat cleanup selects a bounded batch of eligible messages and removes only those rows after Storage succeeds; identity-file references likewise remain retryable after a Storage failure. Refunds: `sweepRefunds` asks `public.wire_refund_work()` for tasks the ledger still owes a wire refund or whose request is due a retry (backoff 1 min → 6 h, 10 tries, then /ops/payments) — no payment-age window. A refused "Choose for me" pick (talk first, conditions, pair cap) moves to the next applicant and is not a failure.
- **Safety controls + SOS (2026-11-15):** `platform_controls` (one row; `/ops/safety`):
  - `posting_paused`: trigger on `deals` insert.
  - `payments_paused`: trigger on `ledger_entries`; everything but `pay_in` is refused with `PT423`, so no release, refund, fee or withdrawal goes through and the transition rolls back.
  - Caps: `max_deal_amount`, `max_customer_daily` (pay-ins by that payer in 24 h) and `max_total_held` are checked by `payin_check()` **before an invoice is created**. A pay-in that really arrived is always booked.
  - `max_open_tasks` (open / awaiting_payment / matched / in_progress) is checked when posting, as is the per-task cap on `amountDue`.
  - `incidents` (server-only): `sos` + report kinds, from either person on the task (`isParty`). One live SOS per (task, reporter) is enforced by a unique index; pressing again updates it. A report needs a kind and 10–1000 chars, max 5 an hour. The other person is never notified.
  - Ops is pushed at once; the tick re-pushes an unacknowledged SOS every 2 min for 30 min (`repingSos`, first step of the tick) and clears incident positions 30 days after resolution.
  - `ops_audit_log` is append-only.
- **Input validation (2026-11-16):** every server action that takes data parses it with a zod schema from `src/lib/input.ts` first (`parseOr` → null = friendly error / no-op; `isValid` when null is itself valid). Shape only — ranges, prices and permissions stay in the engine and lib.
- **Distance (2026-11-16):** two-point tasks (`TWO_POINT_CATEGORIES`: shop, deliver, carry) may carry `pickupLocation`. With both pins `createErrand` sets `details.km = roadKm(pickup, location)` (straight line × 1.3, 0.1 km; > 100 km rejected) and ignores the client's km; otherwise the customer's rough km stands. A pickup pin on any other category is dropped. Fixed at posting (`deals.pickup_lat/lng`, both or neither). "Nearby" for dispatch and feeds is measured from `helperStart` = pickup pin ?? task pin.
- **Replayed webhooks (2026-11-16):** `deal.providerRefs` lists every provider reference booked on the deal (pay-in, top-up, each price change); any `confirm_*` with one of them is a no-op. Found by the price-change random walk: an earlier price change's payment replayed after a second, same-sized change was agreed would have been a second pay-in (the DB's unique index refused it, but as an error). Deep runs before a release: `FUZZ_SEEDS=20000 SIM_SEEDS=200 npm test`.
- **Direct requests (2026-11-16):** `createErrand({ invite: { helperId, openAfter } })` → `deal.invite { helperId, until, openAfter }`. `invitedOnly(deal, now)` = the helper while it stands (always when `!openAfter`; until `until` otherwise). `apply` / `accept` by anyone else → FORBIDDEN. `decline_invite` (that helper): openAfter → `until = now` (opens); else → `expired`. `open_to_all` (customer) → opens now; repeat = no-op. Events `invite_sent` / `invite_declined` / `invite_opened`. Dispatch sends no waves while it stands; it offers + pushes the invited helper once.
- **Bargaining (2026-11-16, replaces the band below):** the customer names any price ≥ `minFeeAt` (only floor). Offers carry `price` + `proposedBy`; commands `apply` (take / name a price), `counter` (customer), `reprice` / `accept_counter` (helper), `set_price` (customer, while open; earlier yeses keep their price), `choose` (not on your own pending counter). After matching: `propose_price` / `answer_price` / `withdraw_price` / `confirm_price` (higher = pay the difference first; lower = refund at once). Service fee stays fixed at posting. Server actions cap any named price at the per-task safety limit.
- **Pricing (2026-11-15, superseded by Bargaining):** `quoteFee` builds the recommended price line by line from effort only (time, distance, round trip, heavy, stairs, tools, night, 2nd person), so any job — even one the app doesn't recognise — gets a sensible price.
  - The customer may move it within `priceRange` (−20%…+30%, never below the minimum: 5,000 by day, 6,000 at night). `createErrand` rejects anything outside.
  - At posting the deal snapshots `serviceFee = serviceFeeFor(postedFee)` (fixed, even if a counter is chosen), `commissionBps = 0`, `details.quotedFee` (the recommendation, kept for learning) and `details.counterMax = counterMaxFor(postedFee)` (+30%, rounded down).
  - Helpers `apply` at the posted price, or with `price` as a counter-offer: more than the posted price and ≤ `counterMax`; one per helper. A price equal to the posted one counts as plain acceptance. No undercutting.
  - `choose` takes the chosen helper's price.
  - Live settings: `pricing_settings` (one row; `/ops/pricing` with worked examples; changes are logged in `ops_audit_log`). Posting reads them via `pricingConfig()`. Engine defaults = DB defaults (tested).
  - Older deals keep their own snapshot (10% commission, flat 1,000 fee).
  - **Not built yet:** moving the recommendation towards real agreed prices once there is data (`quotedFee` vs `fee` are recorded for it).
- **Persistence:** load → `apply()` → `apply_transition()` RPC with optimistic lock; DB re-checks transitions, hold balance per deal, append-only ledger. RLS: clients read only; phone / ДАН name / payout columns are server-only.


## Specialized work (2026-11-16)

- `CategoryConfig.trust`: open = approved helper in the category; pro = approved organisation membership or approved, unexpired trade certificate; care = approved agency membership plus KYC level 4. An invitation alone never qualifies. All qualifying routes are retained, with organisation routes first for new offers. Certificate expiry uses the Ulaanbaatar calendar day.
- Childcare, eldercare, and personal or medical care are outside the launch catalog. The launch migration disables care settings and blocks new offers or assignments for care, while existing assigned bookings retain their original terms. Adult accompaniment is a separate open category for adults who travel independently.
- `Offer.orgId` records the route used to apply. `ErrandDeal.payeeOrgId` snapshots it at assignment. Fee release, material reimbursement and cancellation fees credit `payable:<orgId>` when present; otherwise `payable:<helperId>`. A worker's own earnings exclude jobs paid to an organisation. An owner/manager can view the company balance; personal/organisation bank withdrawals still await the real payment adapter.
- `accept_counter` for care updates the offer to the agreed price and stays `open`; only the customer can then `choose`. Care cannot `accept` or auto-pick. The check window for plumbing/electrical is 72 hours.
- SQL rechecks qualifications when a new offer is inserted and when a helper is assigned. Expiry, suspended organisations/helpers and removed members prevent new assignments. Assigned jobs retain the agreed company payee after membership changes; the recipient cannot be changed while funds are held.
- Organisation registration and bank account insert are one transaction. Owners cannot be removed/re-invited as workers by managers. Workers must accept membership themselves. Organisation care approvals require `kind = agency`; certificates cannot cover care. Expired certificates can be replaced with a new submission.
- Tests: `engine/__tests__/specialized.test.ts`, `db/__tests__/organizations.test.ts`, `__tests__/org-rules.test.ts` cover money paths, matching, consent states, expiry, trust rules, atomic registration and role access.
