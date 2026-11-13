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

## Fees (configurable)
MIN_FEE 5,000 · SERVICE_FEE 1,000 · COMMISSION 10% · CANCEL_FEE 3,000 · CHECK window 24 h (SafePay 24 h or 3 days) · MAX_OFFERS 5 · SafePay buyerFee 1% (min 1,000).
Add-ons (carry): +1,500/floor if helper carries without lift · 2nd person +15,000.

## Money split on errand release
```
spent      = min(receipt, itemBudget)
commission = round(fee * COMMISSION)
helperNet  = fee - commission + spent
refund     = itemBudget - spent
platform   = SERVICE_FEE + commission
held       = itemBudget + fee + SERVICE_FEE      // helperNet + refund + platform == held
```
Example: fee 40,000, budget 5,000, receipt 3,250 → helper 39,250 · refund 1,750 · platform 5,000 · held 46,000.
SafePay: buyer pays price + buyerFee; seller gets price.

## Cancellation / refunds
Before match: free. After match, before start: CANCEL_FEE to helper, rest refunded. Helper cancels: full refund + helper penalty. No match by deadline: auto full refund. Receipt over budget needs customer approval.

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
- **Errand lifecycle (2026-11-13, supersedes "pay at posting" above):** post free → `open` (dispatched to helpers, nothing held) → helper `accept`s (Instant) or customer `choose`s an offer (Custom, offer may carry a `price`) → `awaiting_payment` with `payBy` = +10 min → provider webhook `confirm_payment` → `matched` (held) → `in_progress` → `check` → `released`. A match not paid in time (`expire`) goes back to `open` (event `payment_timeout`; the chosen offer is dropped and `fee` resets to `postedFee`), or `expired` if the match deadline passed too. Before payment the helper may withdraw without a penalty (`helper_withdrew`, back to `open`); the customer may cancel `open`/`awaiting_payment` for free. Legacy deals paid at posting still work (accept → `matched`, cancel/expire refund).
- **Extra rules:** night minimum fee 6,000 (22:00–07:00 UB time) · no helper by `matchBy` (30 min for Now, the scheduled time otherwise) → `expired`, nothing charged · title ≤ 40, description ≤ 500 chars · task pin must be inside Mongolia.
- **Instant price:** `quoteFee(category, details)` = category base + distance + add-ons (carry without lift: +1,500 per floor above the 1st; 2nd person +15,000; round trip "Буцаж ирэх": +50% of the distance part, rounded to 500, only when there is a distance). `createErrand` rejects a fee below the quote — customers can only raise it.
- **Buy-for-me budget buffer:** optional "up to 10% over" switch → the deal holds budget + 10% (`heldItemBudget`); unused money comes back at release like any unspent budget.
- **Receipt over budget (top-up):** `record_receipt` above `itemBudget` sets `topUp = pending` (event `topup_requested`); the helper can't finish while it is pending. The customer either pays the difference — provider webhook `confirm_topup` (idempotent on its own `providerRef`) moves it into the hold and raises `itemBudget`, so the helper is reimbursed the full receipt — or `decline_topup`: the receipt is cleared, the helper returns the items and finishes without one, earning only the task fee. A new receipt within budget replaces a pending request (helper dropped items). Only while `in_progress`. Helper cancel after a paid top-up refunds both payments. DB: `deals.top_up` jsonb; `apply_transition()` writes `item_budget` + `top_up`.
- **Carry eligibility:** heavy + lift not "yes" + floor > 2 → 2 people required (engine rejects 1).
- **Extra transitions** beyond the diagram above: `awaiting_payment → expired | cancelled` · `in_progress → cancelled` (helper cancels: full refund + 3-day suspension) · goods `held → cancelled` (seller cancels before handover: full refund). The DB trigger `deal_status_allowed()` mirrors this list.
- **Not built yet:** Custom mode (quotes, pay on choosing) — engine still has `now` (first-to-accept) and `schedule` (applicants, paid upfront); Ops `split`; a time limit on an unanswered top-up (today the helper waits or drops items).
- **Dispatch (UBCab-style, `src/lib/dispatch/`):** helpers go online with a radius (1/3/5/10 km, district ≈ 15, city 60) and send their position about once a minute while online (`helper_presence`; stale after 10 min). An `open` task goes out in waves: ≤5 best within 2 km (45 s) → ≤10 within 5 km (45 s) → ≤25 within 10 km (60 s) → everyone left city-wide; an empty wave widens at once; a helper is never offered the same task twice and only within their own radius. Rank = 55% distance + 25% rating (Bayesian, prior 4.5★×5) + 10% reliability (offers won / received, 30 days) + 10% experience. Offers are pushed (Web Push) with the exclusive window; anyone eligible may still take it from the nearby feed. When the task leaves `open`, the winner's offer is `won` and the rest `closed` — the post disappears from every feed. Triggers: posting, the customer's searching screen (every 10 s), and `GET /api/cron/tick` (Bearer `CRON_SECRET`; also settles due expiries / auto-releases). Distance is haversine in SQL (`dispatch_candidates`, `nearby_open_deals`); PostGIS can replace it.
- **Persistence:** load → `apply()` → `apply_transition()` RPC with optimistic lock; DB re-checks transitions, hold balance per deal, append-only ledger. RLS: clients read only; phone / ДАН name / payout columns are server-only.
