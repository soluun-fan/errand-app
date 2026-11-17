# Shifts (Ээлж / Түр ажил): plan

Status: **planned, not built.** Owner, 2026-11-17: day jobs and short gigs in their own section,
not full-time employment; anyone may post (a person or a business); **the money is held** like an
errand so nobody gets scammed. Build after the launch blockers (real QPay + SMS, hosting, the
scheduler, the lawyer review), starting as a small pilot in Ulaanbaatar.

## What it is
A poster needs one or more people for a few hours on a set day, paid by the hour or per shift:
"Saturday 10:00–18:00, 3 people, 8,000₮/hour, carrying stock at the warehouse". Workers apply,
the poster picks, the money is held, people check in and out, the poster confirms, each worker is
paid. Not full-time work, not remote freelancing (design, translation): that's a different product.

## How it differs from an errand
| | Errand (today) | Shift |
|---|---|---|
| People | 1 (2 for heavy carrying) | 1–10 per post |
| Pay | one price for the job | hourly or per shift, × hours, × people |
| Time | now or a set time, ≤ 8 h | a set day and hours; v2: several days |
| Where it lives | Home → post | its own tab **"Ажил"**, a list by date and pay |
| Poster | anyone | anyone with an ID check (people) or a registration number (businesses) |

## Design: one shift = a post + one held errand per worker
To reuse everything that already keeps errands safe, a shift is a **parent post** (what, where,
when, rate, how many people), and each worker who is chosen gets **their own errand deal** of kind
"Өдрийн ажил" (dayjob) linked to it. Each of those deals has its own hold, check-in/out, proof,
release, dispute, rating and back-out rules, so one worker's problem never touches the others'
money. This also solves the open "2-person job" question (split payouts) the simple way.

```
shift post (3 people, Sat 10–18, 8,000₮/h)
 ├─ deal A: worker Bat    held 64,000₮ → released after check-out + confirm
 ├─ deal B: worker Nomin  held 64,000₮ → refunded (no-show), seat reopened
 └─ deal C: worker …      held 64,000₮ → disputed (hours), Ops decides
```

## Flow
1. **Post** (free): what, place (map pin), day, start–end, break, rate (hourly or per shift),
   number of people, requirements (lifting, own tools, clothing), photos. The app shows the total
   per person and for everyone before posting.
2. **Workers apply** from the "Ажил" tab (nearby first, by kind of work they picked); they can ask
   in chat before being chosen, like errands today.
3. **Poster chooses** up to N workers; **pays per chosen worker** within the payment window → that
   worker's deal is held by the bank. Unfilled seats stay open; helpers are notified again.
4. **Day of the shift:** a reminder the evening before and 1 h before; the worker **checks in**
   (location + a start photo, as errands) and **checks out** (location). Hours = check-out −
   check-in − break, rounded to 15 min, capped at what was held.
5. **Poster confirms hours** (or disputes) within the check window; silence → auto-release, like
   errands. Leaving early → only the hours worked are paid, the rest is refunded. **Overtime** needs
   the poster's OK and a top-up payment first (the existing price-change / top-up path).
6. **Ratings** both ways.

## Money (same rules as errands)
- Integer tögrög, computed by the engine; nothing moves without the payment provider's webhook.
- Per worker: `held = rate × planned hours (+ service fee)`; on release
  `worker + refund + platform == held`. Sum of held deals == the bank's hold balance.
- Fees: none as a % of pay (owner's pricing stance); the per-deal service fee as on errands.
- **Multi-day (v2):** each day is its own held deal, paid before that day; nobody works a week unpaid.

## Protection
- **Worker:** money held before they start; minimum hourly rate (set in Ops, ≥ the legal minimum
  wage, owner to confirm the figure); max 12 hours a day with a break; 18+ only (already);
  dangerous work (heights, chemicals, driving) not allowed in v1; SOS and incident reports (already).
- **Poster:** ID-checked workers; ratings; back-out penalties (free within 10 min of being chosen,
  then 1 / 3 / 7-day pauses, as errands); a no-show is refunded and the seat reopens at once.
- **Late cancellation by the poster:** a cancel fee per chosen worker, as errands (paid to the
  worker from the hold).
- **Posters:** people need the ID check (kyc ≥ 3); businesses need a registration number (the
  organisation check we already have). Ops can pause a poster.

## Screens (v1)
- Tab **"Ажил"**: list of shifts (day, hours, rate, total, people needed, distance), filters by day
  and kind; a shift page with "Хүсэлт илгээх" (apply).
- Post a shift: one form, 3 steps (what & where → day & hours & people → pay & review).
- Poster's shift page: seats (chosen / open), applicants, chat, pay per worker, attendance, confirm.
- Worker's shift page: check-in / check-out, hours, pay status.
- Ops: shifts list, disputes about hours, paused posters.

## Data (sketch)
- `shifts` (id, poster_id, org_id?, title, description, category, location, address, day, start,
  end, break_minutes, rate, rate_kind hourly|shift, people, status, created_at).
- `deals.shift_id` → each worker's errand deal links back; the engine gets `hours_worked` and a
  pay-by-hours rule for these deals.
- `shift_attendance` (deal_id, check_in_at/lat/lng, check_out_at/lat/lng) — or reuse proofs.
- All writes through the engine and `apply_transition`, as today; server-only tables, RLS on.

## Phases
1. **v1 pilot:** single-day shifts, 1–10 people, Ulaanbaatar, everyday work only; Ops watches every
   shift.
2. **v2:** multi-day (one held deal per day), repeat a shift, "book the same people again".
3. **v3 (maybe):** businesses' monthly statements; remote freelancing is a separate product.

## Questions for the lawyer
1. Does matching people with paid shifts make us an **employment agency** (licence)? Does it
   change if the poster is a person rather than a business?
2. Is a shift worker an **employee** of the poster under the Labour Law (contract, social
   insurance)? What must the app say or collect so posters don't use it to avoid contracts?
3. **Income tax:** who reports or withholds it: the worker, the poster, or us?
4. **Injury** during a shift: who is liable; is insurance needed?
5. **Minimum wage** per hour that applies; can we enforce it as a floor?
6. **Holding the money** (same open question as errands: the bank holds it, not us; licensing).

## Open questions for the owner
- The minimum hourly rate and the maximum shift length.
- Whether a person (not a business) may post shifts for more than e.g. 3 people.
- Whether shifts appear on Home or only in the "Ажил" tab.
