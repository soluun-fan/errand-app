-- Paying through wire.mn without escrow (owner, 2026-11-18: "connect the payment method to wire.mn
-- (for now we cant do any escrow)"; picked: only our fee through wire, the customer pays the helper
-- directly; the fee is refunded unless the customer cancels late).
--
--   * deals.pay_mode: 'held' (the whole amount held — escrow, older tasks) or 'direct' (only our
--     service fee goes through the provider). Fixed when the task is posted.
--   * platform_rules.pay_mode: what new tasks use. 'direct' now; 'held' only once holding money
--     is legally cleared.
--   * provider_payments: each payment we asked the provider for (wire PaymentIntent id), its state
--     and the charge it produced (refunds go against the charge).
--   * provider_events: webhook events already handled (the provider may send one twice).
--   * provider_refunds: refunds sent to the provider; the background job retries until done, and
--     anything the provider can't do automatically ('manual_required') goes to Ops.
--   * direct_payments: the helper's pay, paid by the customer directly: "paid" / "received" / "not
--     paid" marks. An open "not paid" report alerts Ops and stops the customer posting new tasks.
-- All server-only (RLS on, nothing granted to anon / authenticated).

alter table public.deals
  add column pay_mode text not null default 'held' check (pay_mode in ('held', 'direct'));

alter table public.platform_rules
  add column pay_mode text not null default 'direct' check (pay_mode in ('held', 'direct'));

create table public.provider_payments (
  id            text primary key check (length(id) between 3 and 100),
  provider      text not null check (provider in ('mock', 'wire')),
  deal_id       uuid not null references public.deals (id) on delete cascade,
  purpose       text not null check (length(purpose) between 1 and 80),
  amount        bigint not null check (amount > 0),
  status        text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'canceled', 'refunded_late')),
  checkout_url  text check (checkout_url is null or checkout_url ~ '^https://'),
  charge_id     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  succeeded_at  timestamptz
);
create index provider_payments_deal_idx on public.provider_payments (deal_id, created_at desc);
-- one live attempt per deal and purpose
create unique index provider_payments_one_pending on public.provider_payments (deal_id, purpose) where status = 'pending';

create table public.provider_events (
  id          text primary key check (length(id) between 3 and 100),
  type        text not null,
  received_at timestamptz not null default now()
);

create table public.provider_refunds (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references public.deals (id) on delete cascade,
  payment_id   text not null references public.provider_payments (id),
  amount       bigint not null check (amount > 0),
  status       text not null default 'pending' check (status in ('pending', 'succeeded', 'manual_required', 'failed')),
  provider_ref text,
  reason       text check (reason is null or length(reason) <= 200),
  error        text check (error is null or length(error) <= 500),
  attempts     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index provider_refunds_open_idx on public.provider_refunds (status) where status in ('pending', 'failed', 'manual_required');

create table public.direct_payments (
  deal_id            uuid primary key references public.deals (id) on delete cascade,
  amount             bigint not null check (amount >= 0),
  customer_paid_at   timestamptz,
  helper_received_at timestamptz,
  unpaid_reported_at timestamptz,
  resolved_at        timestamptz,
  resolved_by        uuid references public.profiles (id),
  note               text check (note is null or length(note) <= 500),
  updated_at         timestamptz not null default now(),
  constraint direct_payments_resolved check ((resolved_at is null) = (resolved_by is null))
);
create index direct_payments_unpaid_idx on public.direct_payments (unpaid_reported_at) where unpaid_reported_at is not null and resolved_at is null;

alter table public.provider_payments enable row level security;
alter table public.provider_events enable row level security;
alter table public.provider_refunds enable row level security;
alter table public.direct_payments enable row level security;
revoke all on public.provider_payments, public.provider_events, public.provider_refunds, public.direct_payments from anon, authenticated;
