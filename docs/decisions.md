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
- **Address search:** pin-first for now; text place search (Nominatim / paid geocoder) only if users ask.
- **Unanswered top-up:** should a pending over-budget request expire (e.g. after 30 min → treat as declined)? Today it waits; the helper can drop items instead.
