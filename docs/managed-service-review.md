# Guigere managed service review

Prepared 2026-11-22 for Guigere's owner, Mongolian legal counsel, accountant and payment provider.
**Draft proposal for review. No professional approval has been obtained.** Guigere is the name
provided by the owner; its registered legal name, entity type, registration number, tax number,
registered address and authorised signatory still need confirmation.

## Proposed business arrangement

Guigere sells the customer a defined errand service, arranges a suitable provider, handles
complaints and remains responsible for its customer obligations. Guigere separately engages
the provider to deliver the agreed result for a stated task fee. A customer refund must not
automatically become a deduction from a worker's unrelated earnings.

Use [one standing agreement](contractor-agreement-draft.md) and a
[versioned job order](work-order-draft.md) for each accepted job. This is a candidate commercial
arrangement, not a conclusion that every worker is legally an independent contractor or that
Guigere is exempt from payment regulation. Do not describe contractors as part-time employees
or their fees as wages unless the actual relationship is employment.

## Questions that determine the arrangement

| Reviewer | Decision required | Evidence to review |
|---|---|---|
| Mongolian lawyer | Which tasks and working practices permit a civil work contract? When must Guigere use an employment contract? | Actual dispatch, acceptance, instructions, pricing, repeat work, availability requirements, ratings, pauses and location collection |
| Mongolian lawyer | Are completion review, cancellation compensation, evidence, complaints, liability and electronic acceptance terms enforceable? | The proposed agreements, current public terms, app screens, notification and dispute records |
| Accountant | Who registers, withholds and pays tax and social insurance, at what rates and on which income? | Individual versus organisation providers; repeat and occasional work; service fees, reimbursements, cancellations and refunds |
| Accountant | How are customer receipts, revenue, contractor costs, purchase receipts and outstanding obligations recorded? | Sample complete/refunded/disputed jobs and provider settlement statements; e-receipt and VAT requirements |
| Payment provider and lawyer | Does this exact collection and payout arrangement fit the approved merchant service? Who receives and controls funds at each step? | Account ownership, checkout, webhook, settlement, customer refund, worker payout and reconciliation flows |
| Payment provider and lawyer | What additional permissions or service are needed for shopping budgets and SafePay? | Pass-through purchase money, seller payments, payment delays, chargebacks, insolvency and unclaimed amounts |

### Legal starting points

- Labour Law article 41.3 addresses factual employment relationships disguised by other
  contracts. Article 66.4 generally gives part-time employees the same rights and obligations
  as full-time employees. Fewer hours or a different title do not resolve classification.
  [Labour Law](https://legalinfo.mn/mn/detail?lawId=16532053891911).
- Civil Code articles 343–346 address work performance contracts, remuneration and payment
  timing. Ask counsel which provisions fit each service category and which protections cannot
  be changed by agreement. [Civil Code](https://legalinfo.mn/mn/edtl/16532510240071).
- Social Insurance General Law article 32.2.1 expressly refers to employment, work-performance,
  work-for-hire and similar contracts; articles 32.2.2–32.2.3 address contributions and reporting.
  Do not assume a contractor pays everything voluntarily or that Guigere has no obligations.
  [Social Insurance General Law](https://legalinfo.mn/en/edtl/16960373329851).
- National Payment System Law article 3.2 includes payment services supplied within a limited
  scope, and article 10 concerns authorisation. Calling an amount a service fee or wages does
  not establish a payment-services exemption.
  [National Payment System Law](https://legalinfo.mn/en/edtl/16758239966811).

The linked English texts are translations; counsel should verify the current Mongolian text
and implementing rules. These references identify review questions, not a legal opinion.

## Actual implementation to show reviewers

| Step | What the code does today | Review or implementation gap |
|---|---|---|
| Customer payment | Customer chooses a helper and prepays the service fee, purchase budget if any and platform charge. A provider webhook records payment; provider selection is deployment configuration. | Confirm the actual production provider, contracting entity, merchant account and settlement ownership. A technical `hold` ledger account is not evidence of a bank escrow arrangement. |
| Worker payment approval | Confirmation, an undisputed review expiry processed by the app, or an Ops release credits `payable:<payee>`. Purchase reimbursement is separate from the service fee in the ledger. | Define enforceable due dates, deductions and reimbursement handling. A worker has no bank transfer merely because a job says `released`. |
| Payout request | A checked account in the payee's own name is required. A request moves the full available amount into a payout queue. Operations sends the money and records sent or failed. | Confirm the transfer evidence and reconciliation process. The 15-minute operating target is not a stored contractual deadline or confirmation of bank arrival. |
| Automatic requests | The configured age of unclaimed earnings triggers a request for an eligible checked account. | This is queueing, not automatic bank transmission. Failed requests and unhealthy scheduling require an operational fallback. |
| Organisations | Some jobs credit the organisation rather than the individual worker. | Use a separate organisation agreement; the organisation's worker pay must not be represented as money Guigere owes that individual. |
| Existing direct-pay jobs | Historical fee-only jobs expect the customer to pay the helper directly. | Preserve their recorded arrangement; exclude them from managed-service personal earnings totals. |
| Disputes | Current engine supports release or refund of a disputed job. | Partial settlement and paying an undisputed portion are proposed policy needs, not existing engine capabilities. |
| Legal acceptance | Standing document versions and user acceptance times are recorded. Task details, prices and timeline events also exist. | Public legal text interpolates current Ops settings. Preserve the full accepted document and job-order revision before describing it as an immutable contract. |

Code references: `src/lib/legal.ts`, `src/lib/legal-params.ts`, `src/lib/engine/deal.ts`,
`src/lib/withdrawals.ts`, `src/lib/payments/`, `src/lib/job-location.ts`.

The 2026-11-21 read-only deployment audit found a stale application scheduler heartbeat despite
active pg_cron runs. Resolve and verify scheduler reliability before relying on automatic review
closure or payout requests. A review deadline passing must remain visibly pending until the
recorded approval actually occurs.

## Customer and worker experience

Use one shared job record, with different next actions for each party. Keep scope, price,
changes, evidence and progress together; avoid requiring users to repeat information in chat.

| Stage | Customer | Worker |
|---|---|---|
| Request | Describe the result, pin locations, choose time and add photos if useful. See full price and expense limit. | See scope, approximate area, effort, equipment, proposed fee and review rules before applying. |
| Agreement | Choose a helper and approve the exact service and price. | Apply or quote freely; show whether this is an application, reserved match or funded job. |
| Work | See progress, contact and optional active-job location with freshness. | Start, reach addresses, report a problem and submit evidence through one primary action per stage. |
| Change | Review the extra work, new total and timing before agreeing. | Propose a revision before doing extra work or exceeding an expense limit. Both parties retain the previous revision. |
| Completion | Review evidence, confirm or identify a specific problem by the displayed deadline. | See submitted evidence, review deadline and any dispute; submitting work is not a bank transfer. |
| Payment | See approved completion, any refund and help access. | Distinguish approved funds, requested payout and recorded transfer; show request and decision dates. |

Provide a visible way to stop unsafe work, reach support and challenge a decision. Do not
promise background GPS: this web app shares foreground positions with permission and must show
when they are stale. Work location sharing is separate from dispatch availability; exact
addresses are disclosed only to authorised participants when needed.

## Deliverables and next decisions

- **Implemented now:** clearer English/Mongolian earnings stages, review deadlines including
  overdue pending approval, truthful requested/sent payout labels, decision dates, live configured
  automatic-request interval, and error propagation instead of hiding failed financial reads.
  The job screen explains approval and separate bank payout before application. The customer
  completion message distinguishes approval from a bank transfer.
- **Prepared for review:** standing agreement and job-order drafts linked above, customer booking
  terms in the order draft, actual money-flow inventory and reviewer questions.
- **Still required before adopting the proposed contracts:** entity particulars, written reviews,
  final Mongolian wording, effective dates, complete accepted-document snapshots, required
  deduction/insurance logic, any new cancellation or partial-dispute logic, and payout due dates
  with escalation. Review existing public draft terms against the approved arrangement too.

Do not publish these drafts as accepted terms or advertise an escrow exemption. No new legal
version, contract acceptance, tax rate, bank integration or hosted database migration is part of
this change. SafePay requires its own review; this arrangement cannot approve it by analogy.
