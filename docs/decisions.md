# Decisions & open questions (read only when asked "why")

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
- Supabase chosen over Prisma (auth + storage + Postgres in one; RLS). Prisma removed.
- Mock OTP = Supabase Send SMS hook writing to a private outbox; dev screen shows the code (`DEV_SHOW_SMS_CODES`).
- Docs: DESIGN.md wins over UI-FLOWS.md on layout/navigation (3-tab floating bar, chat inside the deal, SafePay as a home tile, `46,000₮`).

## Waiting on a decision
- **Map + place search provider** (Google Maps Platform / Mapbox / OpenStreetMap+Nominatim): needed for skeleton A maps, address search with distances, travel-time matching. Until then: text addresses, distance chips, map placeholder.
- **AI photo draft provider** (needs an API key and a cost budget). Until then: text-first post; photo upload comes with storage.
- **Custom mode payment timing:** quotes first, pay on choosing (rules.md) means a "quoting" state before `awaiting_payment` — confirm before building.
- **Round trip (Буцаж ирэх) price** — no rule yet, so the toggle is not shown.
- **Receipt over budget:** needs a top-up payment flow.
