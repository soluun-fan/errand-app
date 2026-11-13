@AGENTS.md

# Tuslamj Hub

Mongolian (UB-first) errand marketplace + held payments. Customers post small physical tasks; verified helpers do them; payment is held by a partner bank until the customer confirms. **SafePay** reuses the same hold engine for buying from strangers. One deal engine powers both.

## Read only what the task needs
| Working on | Read |
|---|---|
| Deal logic, money, states, DB, payments, tests | `docs/rules.md` |
| Any UI (tokens, components, layout) | `docs/ui.md` |
| A specific customer screen | `docs/screens-customer.md` |
| Helper or Ops screens | `docs/screens-helper-ops.md` |
| User-facing text | `docs/copy.md` (the live strings are in `src/i18n/`) |
| Why a decision was made / open questions | `docs/decisions.md` |

- `reference/*.png`: look at a screenshot **only** when building the screen it matches (listed in `docs/ui.md`).
- `prototype/index.html`: working demo of the full logic.
- `archive/`: long human-readable versions (DESIGN.md, UI-FLOWS.md, first brief). **Do not read** unless asked.

## Non-negotiables
- Money is **integer tögrög**, computed by the engine only; display as `46,000₮` (`fmtMoney`).
- Deal status changes on a **payment-provider webhook only**, never on a screenshot. Webhooks are idempotent.
- Invariant on every release: `helperNet + refund + platform == held`. Sum of held deals == bank hold balance.
- Reject illegal state transitions server-side. Each transition writes a timeline event (+ a ledger entry if money moves).
- We never hold funds ourselves: all money calls go through the `PaymentProvider` interface (`MockProvider` first).
- Phone numbers never shown in plain text; chat masks them.
- All strings via i18n (`mn` default, `en`).

## Where things are (built)
- `src/lib/engine/` pure deal engine (state machine, money, ledger). `src/lib/db/` mapping + repository.
- **Writes:** never touch `deals` / `ledger_entries` / `timeline_events` directly — `runCommand()` / `insertDeal()` in `src/lib/db/deals.ts` (one `apply_transition()` RPC, optimistic lock on `version`).
- **Supabase** (chosen): `supabase/migrations/` (tested in PGlite by `npm test`), phone OTP via the Send SMS hook (dev shows the code on screen).
- UI: `src/components/` design system, `src/i18n/` strings, gallery at `/dev/components`.

## Stack
Next.js 16 (App Router) + TypeScript + Tailwind 4 · Supabase (Postgres, auth, storage) · mock SMS OTP · cron job for auto-release/expiry · mobile-first web.

## Build order
1. ✅ Setup, schema, seed, mock OTP auth
2. ✅ Deal engine module + unit tests (`docs/rules.md` §Tests)
3. ✅ UI tokens + components page (`docs/ui.md`)
4. ✅ Customer flow: post (free, map pin) → match → pay held (mock) → live → check → confirm/dispute → rate
5. Helper: ✅ online + radius, wave dispatch + Web Push, nearby feed, accept/quote/withdraw/start · ⏳ proof upload (photo/video + AI checks), earnings
6. Chat with masking + LiveKit voice/video calls · 7. Two-way ratings · 8. SafePay · 9. Ops panel · 10. Background jobs (✅ `/api/cron/tick`; scheduler TBD) · 11. MN copy review · 12. Real QPay/bank adapters

Keep this file short. Put new detail in the matching `docs/` file.
