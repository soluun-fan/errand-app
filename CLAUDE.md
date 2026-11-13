@AGENTS.md

# Tuslamj Hub — project brief for Claude Code

> Read this first. It is the single source of truth for what we are building, why, and the rules the code must follow.
> A working single-file prototype is in `prototype/index.html` (open it in a browser; switch roles with "Viewing as").

## 1. What this is

A Mongolian (Ulaanbaatar-first) **errand marketplace + protected payment ("SafePay") hub**.

- **Errands:** a customer posts any small physical task (shopping run, carrying furniture, queueing, pick-up/delivery, small repair). Nearby verified helpers accept or apply. The customer's payment is **held** until the job is confirmed done.
- **SafePay links:** two strangers buying/selling an item (Facebook, Unegui, etc.) use the same hold engine: buyer pays into hold → seller hands over → buyer confirms → money released.
- **One deal engine** powers both. Build it once.

Main references: Haejuseyo (해주세요, Korea) for errand UX and rules; Airtasker for offer → held payment → release; Bunjang / Escrow.com for goods escrow (check window, auto-confirm).

## 2. Users and roles

| Role | Can do |
|---|---|
| Customer | Post tasks, pay into hold, choose helper, chat, confirm/release, dispute, rate; create/open SafePay deals |
| Helper | Needs approval. Sees task feed for own categories, accepts (Now) / applies (Schedule), uploads proof, gets paid, withdraws |
| Ops (admin) | Approve helpers, resolve disputes, view bank-hold ledger, see all deals |

One app with a **mode switch** ("Тусламж хэрэгтэй / I need help" ↔ "Туслая / I'll help"), like Haejuseyo's 해주세요 / 해줄게요 tabs.

## 3. Core business rules (implement exactly)

**Posting**
- Customer sets the helper fee. Minimum ₮5,000 (configurable; consider a night minimum).
- Show a *suggested fee* (category base + distance). Customer can edit.
- Optional **item budget** for purchases (reimbursed by receipt; unspent part returned).
- Two modes:
  - **Now:** notify nearby helpers; **first to accept** gets it.
  - **Schedule:** up to **5 applicants**; customer chooses one.
- Payment is collected when posting and **held**. No helper matched in time → **automatic full refund**.

**Cancellation**
- Before match: free, full refund.
- After match, before start: ₮3,000 fee paid to the helper; rest refunded.
- Helper cancels: full refund to customer; helper penalty (e.g. 3-day suspension).

**Completion & release**
- Helper must upload proof before "Done": receipt amount + photo (if item budget > 0) and a **handover photo** (time + GPS).
- "Done" starts a **check window** (24 h for errands; seller-chosen 24 h / 3 days for SafePay).
- Customer confirms → release. No action before window ends → **auto-release**.
- Customer reports a problem → **disputed**, release paused, Ops decides **release** or **refund**.

**Money split on errand release** (all integers, tögrög)
```
spent        = min(receipt, itemBudget)
commission   = round(fee * 0.10)            // demo value, configurable
helperNet    = fee - commission + spent
refund       = itemBudget - spent
platform     = SERVICE_FEE (₮1,000) + commission
held         = itemBudget + fee + SERVICE_FEE   // invariant: helperNet + refund + platform == held
```
**SafePay:** buyer pays `price + buyerFee` (1%, min ₮1,000); seller receives `price`.

**Payouts** only to a bank account in the helper's **own verified name** (name must match ДАН). Otherwise hold the payout.

**Anti-scam rules**
- Status changes **only** on a payment-provider confirmation (webhook), never on a user screenshot.
- Chat masks phone numbers (8-digit patterns, +976) and warns on "cash / pay directly / бэлэн / данс" phrases.
- SafePay deals open only inside the app by code/link; show "Genuine SafePay deal" banner + seller trust card (ID verified, completed deals, upheld complaints).
- Banned tasks: alcohol/tobacco for others, medicines, rides, childcare, entering homes alone (MVP).

## 4. Deal state machine

```
errand: awaiting_payment → open → matched → in_progress → check → released
            │                │        │          │          └──→ disputed → released | refunded
            │                │        │          └→ cancelled (helper cancels: full refund + penalty)
            │                │        └→ cancelled (customer: fee to helper, rest refunded;
            │                │                      helper: full refund + penalty)
            │                ├→ cancelled (full refund)
            │                └→ expired (no helper, full refund)
            └→ cancelled (no money moved)

goods:  awaiting_payment → held → check (handed over) → released
            │               │        └──→ disputed → released | refunded
            │               └→ cancelled (seller cancels before handover: full refund)
            └→ cancelled (no money moved)
```
Every transition writes a timeline event and (if money moves) a ledger entry. Reject illegal transitions on the server.

Implemented in `src/lib/engine/` (pure, no I/O). Run `npm test`.

**Persistence rule:** never write `deals`, `ledger_entries` or `timeline_events` directly. Load the deal,
run `apply()` from the engine, then persist with `runCommand()` / `insertDeal()` in `src/lib/db/deals.ts`
(one `apply_transition()` RPC, optimistic lock on `version`). The database re-checks status transitions
and the hold balance, keeps the ledger append-only, and RLS makes every table read-only for clients.
Schema changes go in a new file under `supabase/migrations/`; `src/lib/db/__tests__` runs them in PGlite.

## 5. Verification (KYC) levels

| Level | Who | Requires | Unlocks |
|---|---|---|---|
| 1 Basic | customers | phone + SMS OTP | small tasks |
| 2 Verified | larger tasks, SafePay | ДАН consent (name, register no., DOB) | higher limits, SafePay |
| 3 Helper | all helpers | ДАН + live selfie vs ID photo + same-name bank account + 18+ + rules quiz + Ops approval | accept tasks, payouts |
| 4 Trusted | sensitive categories | Level 3 + no-criminal-record certificate + track record | home-entry / high-value tasks |

ДАН integration needs a government data-center agreement — mock it behind an interface for now.

## 6. Payments architecture

**We never hold money ourselves.** A licensed bank partner (target: M Bank) holds funds; QPay is the pay-in rail. Our system is the deal record + rules + instructions.

```ts
interface PaymentProvider {
  createInvoice(dealId: string, amount: number): Promise<{ invoiceId: string; qrText: string }>;
  // provider calls our webhook when paid → we verify, then move deal to held/open
  release(dealId: string, payouts: { to: AccountRef; amount: number }[]): Promise<void>;
  refund(dealId: string, amount: number, to: AccountRef): Promise<void>;
}
```
- Start with `MockProvider` (behaves like the prototype's "Simulate bank confirmation").
- Later: `QPayProvider` (invoice create / payment check / cancel / refund + callback) and a bank adapter for hold/release.
- **Double-entry ledger** table; invariant: sum of held balances == bank hold account balance.
- Idempotent webhook handling (same payment event processed once).
- Money as **integers in tögrög** — never floats.

**Rollout stages**
- Stage 0 (no license needed): customer pays helper directly via QPay *after* the job; app only records it.
- Stage 1: held payments, only after the bank partnership is signed and legal review is done.

## 7. Suggested stack (change if there's a reason)

- Next.js 16 (App Router) + TypeScript, Tailwind
- **Supabase** (chosen): Postgres + phone OTP auth + storage. Local dev via `supabase start`; see README.
- Phone OTP auth (SMS provider TBD — demo numbers with code 123456 in `supabase/config.toml`); file storage for receipt/handover photos
- Cron/queue job for check-window auto-release and no-match expiry
- i18n: Mongolian (default) + English
- Mobile-first responsive web; PWA later

## 8. Data model (starting point)

```
User(id, name, phone, role[customer|helper|admin], kycLevel, helperStatus[pending|approved|rejected],
     rating, completedCount, categories[], payoutAccount, area)
Deal(id, type[errand|goods], status, title, description, category, mode[now|schedule], scheduledAt,
     address, lat, lng, itemBudget, fee, price, buyerFee, inspectHours,
     customerId, helperId, sellerId, buyerId, code, heldAmount, receiptAmount,
     checkUntil, createdAt)
Offer(id, dealId, helperId, note, createdAt)                 // max 5 per scheduled deal
Proof(id, dealId, kind[receipt|handover], fileUrl, amount, lat, lng, takenAt)
Message(id, dealId, fromUserId, text, isSystem, createdAt)
Dispute(id, dealId, openedBy, reason, note, outcome[release|refund], decidedBy, decidedAt)
LedgerEntry(id, dealId, kind, amount, fromAccount, toAccount, providerRef, createdAt)
Rating(id, dealId, fromUserId, toUserId, stars, tags[])
TimelineEvent(id, dealId, text, createdAt)
```

## 9. UX principles (from M Bank / SocialPay research)

- One big plain-language status card on every deal + a 4-step tracker (Paid → Helper found → Done → Released) with the money icon at the current step.
- Main action always one tap from home; never block urgent tasks (no forced updates).
- Engagement: helper levels (Bronze/Silver/Gold → lower commission), customer points, neighborhood challenges, theme colors, completion celebration.
- Later: voice task requests in Mongolian (e.g. Chimege speech tech).
- Accessibility: real buttons/labels, 44px touch targets, 4.5:1 contrast.

## 10. Build order for Claude Code

1. Project setup, DB schema, seed data, auth (mock OTP)
2. Deal engine as a pure, unit-tested module (state machine + money split + ledger invariant) — port logic from `prototype/index.html`
3. Customer flow: post → pay (MockProvider) → offers/accept → track → confirm/dispute
4. Helper flow: approval gate, feed, accept/apply, proof uploads, earnings/withdraw
5. Chat with number masking
6. SafePay links (create, open by code, pay, handover, confirm/dispute)
7. Ops panel: approvals, disputes, ledger
8. Background jobs: auto-release, no-match expiry
9. i18n MN/EN, polish, engagement features
10. Real QPay + bank adapters (when partnership exists)

**Tests that must exist:** money split sums to held amount for every path; no double release; illegal transitions rejected; auto-release fires exactly once; refund paths return full amounts.

## 11. Open questions

- Bank of Mongolia licensing for collecting/holding customer funds — confirm with a lawyer and M Bank.
- M Bank API capabilities (per-deal hold, release speed, fraud freeze).
- QPay merchant fees and onboarding.
- ДАН integration access.
- SMS OTP provider; masked "safe number" calling (Mobicom/Unitel?).
- Final fee values (commission, service fee, SafePay fee).
- Product name (working name: Tuslamj).
- No-match window for "Now" tasks (engine default: 30 min) and for scheduled tasks without a time (default: 24 h).
- What happens if a SafePay seller never hands over? (Today: seller can cancel → full refund; no automatic timeout yet.)
