# Guigere job order and customer booking draft

**Proposed workflow and contract schedule for review, not an active form or accepted agreement.**
Prepared 2026-11-22. Use with the [provider agreement](contractor-agreement-draft.md) and approved
customer terms. Maintain a shared job record while keeping each party's private data restricted.

## Required job order

| Field | What both parties must understand |
|---|---|
| Identity and version | Job ID, order revision, Guigere legal entity, customer and actual provider/payee; standing agreement and customer terms versions |
| Agreed result | A specific deliverable and acceptance criteria, written in plain language |
| Included and excluded work | Quantity, stops, substitutions, carrying, assembly, stairs, waiting and any expressly excluded work |
| Place and access | Approximate area before matching; necessary exact addresses, access instructions and recipient details once authorised |
| Time and effort | Start window, expected duration, deadline and how delays are handled; distinguish an estimate from a promise |
| Equipment and risks | Who supplies tools, vehicle, materials, additional people and required qualifications; disclosed hazards and limits |
| Customer price | Service price, platform charge, authorised purchase budget, other approved charges and maximum authorised total |
| Provider fee | Gross task fee, disclosed platform deductions, required withholding and expected net fee; do not show the customer's purchase budget as earnings |
| Purchases | Who advances funds, limit, permitted alternatives, receipt requirements, unused budget, returns and reimbursement deadline |
| Evidence | Category-appropriate completion proof, recipient acknowledgement if required and privacy restrictions |
| Review and payment | Review start event and duration, effect of expiry, calculable approval/due date, latest payout deadline and failure escalation |
| Cancellation | Charges or compensation for each cause, completed work and expenses, no access, replacement and unsafe-work procedure |
| Support and disputes | Help contact, response/decision deadlines, evidence submission, appeal and external remedies |
| Acceptance | What action forms the contract, each party's identity and timestamp, funded/start condition and preserved revision |

Do not put a fixed net amount on an order if mandatory deductions are still unknown. Calculate
all final amounts through the engine and snapshot the rules used. New financial behaviour needs
engine and database validation before the corresponding contract terms go live.

## Proposed customer booking terms

1. You buy the specified service from **[Guigere legal entity]**, with the provider identified
   in your booking. Guigere is your contact for service problems, replacements and refunds.
2. Review the result, exclusions, location, timing, total price and purchase limit before
   booking. Provide accurate access and safety information; approval of additional work or
   costs must be recorded before it starts.
3. The booking identifies when payment is collected, who receives it and how refunds are
   processed. Do not claim a bank holds funds in escrow unless the actual provider agreement
   supports that statement. A payment screenshot does not establish successful payment.
4. Inspect the completion evidence and confirm or report a specific problem within the
   displayed review period. The final terms must explain the effect of silence and preserve
   mandatory consumer remedies. A missed app deadline must not be described as a universal
   waiver of legal rights.
5. Cancellation, failed access, non-performance, partial work, unused purchases and approved
   additional costs follow the disclosed schedule. Guigere handles the complaint and explains
   the remedy and refund timing; customers should not have to recover funds from a worker.
6. Use in-app contact and report unsafe requests or incidents. Live location is available only
   when shared, with its last update time; it is not a guarantee of continuous tracking or arrival.

Counsel must supply the complete consumer terms, mandatory disclosures, lawful cancellation
schedule and remedy deadlines before this wording becomes binding.

## Example for design review

**Illustrative only, not a real booking:** collect one prepaid parcel from reception and deliver
it to the customer's building entrance between 14:00 and 15:00 Ulaanbaatar time. One person,
parcel up to the disclosed weight; no upstairs carrying, cash collection or assembly. Ask the
recipient to acknowledge delivery using the agreed method; avoid including their face in a photo.

The customer sees a service-price breakdown and no purchase budget. The worker sees their task
fee and any required deductions, no requirement to advance purchase money, the same delivery
result and deadline, and the approved completion-review and payout schedule. If the customer
adds upstairs carrying, both approve a revision with the new scope, fee and timing first.

## UI and storage requirements

- Keep application distinct from acceptance: today a helper applies, a customer chooses and
  payment funds the job. Counsel must identify the contract-forming event; do not relabel an
  application as a final accepted order without changing and documenting its effect.
- Before commitment, show scope, fee, expense exposure, time, cancellation and payment rules
  together, with one clear action and an accessible full agreement. Reuse entered information.
- Preserve the full accepted content and rule values for each revision. Existing deal versions
  are concurrency counters, not a complete immutable history of accepted legal documents.
- Show changed fields and require both necessary approvals. Existing price proposals support
  fee changes; a complete, mutually accepted scope revision is additional work.
- Give the customer proof plus Confirm or Report a problem. Give the worker completion status,
  deadline and payout progress. A dispute pauses automatic approval; a stale timer cannot prove
  that approval or payment occurred.
- Show a late payout as late only against a recorded due date. The current operating target is
  not such a field. Add owner alerts and a support fallback when the agreed service level is missed.
- Test the approved workflow with a delivery, a purchase with unused budget, a scope change,
  cancellation after partial work, disputed evidence, failed bank transfer and scheduler outage
  before enabling the new terms.
