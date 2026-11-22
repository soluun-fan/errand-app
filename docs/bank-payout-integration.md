# Real bank payouts and verification

Status on 2026-11-22: **outgoing bank transfers are not connected**. The app collects payout
requests and Operations transfers through the business bank account separately. The inspected
local configuration uses mock customer payments and has no Wire or bank payout credentials;
deployment configuration must be checked separately before enabling live payments.

## What is corrected now

- Saving an account no longer verifies it merely because a typed holder name matches a verified
  identity. Identity-document approval also no longer approves bank-account ownership.
- Mongolian IBAN input is checked using MOD97-10, beyond its length and prefix. Legacy domestic
  account numbers remain accepted for manual bank lookup. Neither check proves ownership.
- Operations records an independently obtained bank holder name and bank evidence reference.
  The name must match the verified identity and saved account holder. Evidence is audited before
  approval, and the update must match the exact account snapshot the operator reviewed.
- Recording a completed manual payout requires the bank transaction reference. It is saved
  with the atomic withdrawal/ledger decision and displayed in the worker's history as a reference
  recorded by the team. This is not an automatic settlement verification.
- Pending or uncertain bank transfers must stay in the queue. Marking Failed returns money to
  payable earnings, so it is appropriate only when the bank confirms the transfer cannot settle.

Existing `verified_at` values may come from the old name-only checks. They are **not sufficient
evidence for automatic payouts**. Recheck existing destinations and migrate to explicit
verification source, account revision and evidence fields before enabling an automated sender.
This change does not mass-reset existing accounts or move any real funds.

IBAN reference: [Bank of Mongolia IBAN specification, MOD97 example](https://www.mongolbank.mn/file/files/documents/regulation/paymentsystem/2020/20200313_%D0%9066.pdf).

## Bank connection needed

Guigere must identify its business bank or contracted payout provider and obtain its approved
integration documentation and credentials through the bank's secure process. Do not supply
personal internet-banking passwords to this app or paste secrets into chat. Required capabilities:

1. Query the actual owner of a destination account and its eligibility to receive MNT.
2. Send from Guigere's authorised business account to supported Mongolian bank accounts.
3. Retrieve a transfer by a stable client reference after a timeout, without creating a second
   payment; confirm the provider's idempotency behaviour and retention window.
4. Distinguish request acceptance, processing, completed settlement, rejection and reversal.
5. Provide authenticated transaction status or signed callbacks, bank transaction IDs and
   settlement statements for reconciliation.
6. Document transaction fees, limits, account formats, credentials, network requirements,
   test access and the process for uncertain or reversed transfers.

Keep the existing Wire integration for customer collection. Its public merchant API documents
payment status, refunds, operator connections and listing the business's own receiving accounts.
The documented account-selection feature is limited to those business accounts, not workers'
accounts. No arbitrary worker bank-transfer or recipient-ownership endpoint was found in that
reference. Its merchant settlement account is not an outgoing payout API.
[Wire API reference](https://docs.wire.mn/en/docs/api),
[Wire receiving-account guide](https://docs.wire.mn/en/docs/guides/settlement-accounts).

For a concrete capability example, Capitron publishes
[account-owner inquiry](https://open.capitronbank.mn/v1/caminquery) and
[domestic bank transfers](https://open.capitronbank.mn/v1/transactions). This does not select
Capitron for Guigere or establish that Guigere has access. The bank must confirm current response
schemas, settlement semantics and duplicate-prevention behaviour before a production adapter is
implemented. Public sample fields alone are not enough to infer that a transfer has settled.

## Selected bank: Golomt Corporate Gateway (2026-11-22)

Guigere's business account is at **Golomt Bank**. The account number is configuration (Ops
setting / server env), not something to hard-code or commit. Golomt's product for this is the
**Corporate Gateway** (CGW): the business's server connects directly to its own Golomt account.
[Product page (MN)](https://www.golomtbank.com/corporate/digital-bank/corporate-gateway).

What the public page lists (the full API specification is given only after the contract):
- Inquiry: statements, balance, account details, **account name lookup**, transaction receipts,
  previously used counterparties, reference lists (FX, SWIFT, purpose codes).
- Transfers: intra-bank, **interbank**, batch, SWIFT, tax, customs.
- Controls: a per-transaction limit, separate initiate/approve permissions, a Vasco token device.
- Fees (page as read 2026-11-22): Golomt→Golomt 200₮; interbank ≤ 5,000,000₮ 300₮ (400₮ from
  2026-12-16); interbank > 5,000,000₮ 500₮; statements 100,000₮/month. Fees must stay Ops settings.
- Onboarding: corporate customer, official request letter (template on the page), contract at a
  branch or via corporategateway@golomtbank.com. No sandbox, IP or certificate details are public.

Unofficial SDKs exist ([techpartners-asia/golomt-api-go](https://github.com/techpartners-asia/golomt-api-go),
[golomt-corp-gateway-go-sdk](https://pkg.go.dev/github.com/openlib-dev/golomt-corp-gateway-go-sdk/golomt)).
One describes an account-holder lookup that also resolves accounts at other Mongolian banks.
Use them only as hints; build the adapter from Golomt's own specification.

**Questions Golomt must answer in writing before any code is written:**
1. Can transfers run server-to-server without a person confirming each one on the Vasco token?
   If every transfer needs a token, payouts become "app prepares, Ops approves in a batch"; that
   is acceptable and safer for launch.
2. Does the account-name lookup work for **other banks'** accounts (Khan, TDB, State, XacBank…),
   and does it return the full holder name or a masked one?
3. Is there a test/sandbox environment and test accounts?
4. Idempotency: can we send our own unique reference, and query a transfer by it after a timeout?
5. Transfer states (accepted / processing / settled / rejected / returned) and how we learn them
   (callback, polling, statement); how returns/reversals appear.
6. Authentication (certificates, tokens, IP allow-list, mutual TLS), rate and daily limits.
7. Do the documented fees apply to CGW API transfers, and is the 5,000,000₮ tier per transfer?

Expected shape once answered: a server-only `golomt` payout adapter behind the existing
withdrawal queue; account-name lookup replaces the manual "bank holder name" evidence step;
the transfer reference replaces the manually typed reference. Everything below still applies.

## Implementation once the provider is selected

Keep customer collection and outgoing payouts as separate integrations. A provider-specific
adapter must use documented endpoints and server-held credentials; the browser cannot choose
an arbitrary transfer amount, destination, source account or URL.

Only fund real payouts from credits backed by reconciled real payments. Isolate test/mock
transactions and resolve any existing simulated earnings before switching on a live sender.

Use an atomic database operation to reserve an authorised withdrawal and create a durable
transfer attempt before contacting the bank. Snapshot the verified destination, amount, currency
and stable reference. Record the provider transaction ID uniquely. Concurrent actions must not
create a second attempt for the same withdrawal.

An HTTP success or accepted transfer request must remain processing until the bank's documented
status proves completion. On a network timeout or malformed response, retain the reservation and
reconcile the original reference. Never automatically return funds to available earnings or retry
with a new reference while an earlier transfer might still settle.

Before a ledger decision, match the authenticated bank result to the recorded transfer's amount,
currency, destination and reference. Handle duplicate and out-of-order callbacks idempotently.
Record completed settlement atomically with the withdrawal and ledger entries. Treat reversals
as separate financial events and provide an Operations reconciliation queue. Manual completion
must not be allowed to override a live automatic transfer attempt.

Bank ownership checks need their own source, reference, account revision and expiry policy;
invalidate them whenever the destination or verified identity changes. Display the bank-returned
holder to the worker for confirmation, without exposing other people's account data. Apply
appropriate authentication and rate limits to lookups and account changes.

Test account mismatch, wrong amount/currency/destination, duplicate clicks, callback replay,
concurrent workers, bank timeouts, a lost successful response, rejected transfers, reversals and
ledger reconciliation. After synthetic/sandbox tests pass, agree the exact source account,
recipient and amount for a controlled live transfer test. Hosted database migrations require
the owner's explicit approval under the repository's deployment instructions.

Automatic payout scheduling also depends on repairing the previously identified scheduler
heartbeat issue; an unhealthy job runner cannot be relied on to reconcile bank outcomes.
