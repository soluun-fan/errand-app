-- Safety pack, parts 1–2 (docs/decisions.md 2026-11-15 "Safety pack").
--   * platform_controls: ONE row Ops changes from /ops/safety, no deploy needed:
--       - posting_paused  → no new tasks (trigger on deals, so no code path can skip it)
--       - payments_paused → money freeze: nothing leaves the hold or a payable account
--         (trigger on ledger_entries). Pay-ins are still BOOKED: if the bank says money
--         arrived, we must record it — refusing it would lose track of real money. New pay-ins
--         are stopped earlier instead, before an invoice exists (payin_check()).
--       - caps on what can be held: per task, per customer per 24 h, platform-wide (beta
--         blast-radius limit). Checked by payin_check() before an invoice is created.
--   * incidents: SOS and problem reports. Server-only (no client grants), like KYC data.
--   * ops_audit_log: append-only record of what Ops changed and decided.

-- ---------------------------------------------------------------------------
-- Controls
-- ---------------------------------------------------------------------------
create table public.platform_controls (
  id                  boolean primary key default true check (id), -- exactly one row
  posting_paused      boolean not null default false,
  payments_paused     boolean not null default false,
  pause_note          text check (pause_note is null or length(pause_note) <= 300),
  max_deal_amount     bigint not null default 300000 check (max_deal_amount > 0),
  max_customer_daily  bigint not null default 600000 check (max_customer_daily > 0),
  max_total_held      bigint not null default 5000000 check (max_total_held > 0),
  max_open_tasks      integer not null default 3 check (max_open_tasks between 1 and 50),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id)
);
insert into public.platform_controls default values;
alter table public.platform_controls enable row level security;
revoke all on public.platform_controls from anon, authenticated;

create function private.controls_keep_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform_controls must keep its single row';
end;
$$;
create trigger controls_keep_row before delete on public.platform_controls
  for each row execute function private.controls_keep_row();
create trigger controls_no_truncate before truncate on public.platform_controls
  for each statement execute function private.controls_keep_row();

-- New tasks / SafePay deals while posting is paused → refused (SQLSTATE PT423).
create function private.deal_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce((select c.posting_paused from public.platform_controls c), false) then
    raise exception 'posting is paused' using errcode = 'PT423';
  end if;
  return new;
end;
$$;
create trigger deal_insert_guard before insert on public.deals
  for each row execute function private.deal_insert_guard();

-- Money freeze: every ledger entry except a pay-in moves money out of the hold (release,
-- refund, fee) or out of a payable account (withdrawal) → refused while paused. The whole
-- transition rolls back with it, so the deal keeps its state and the timer retries later.
create function private.ledger_freeze_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind <> 'pay_in' and coalesce((select c.payments_paused from public.platform_controls c), false) then
    raise exception 'money movements are paused' using errcode = 'PT423';
  end if;
  return new;
end;
$$;
create trigger ledger_freeze_guard before insert on public.ledger_entries
  for each row execute function private.ledger_freeze_guard();

-- Before creating an invoice: null = OK, otherwise why not
-- ('payments_paused' | 'cap_deal' | 'cap_daily' | 'cap_total').
create function public.payin_check(p_deal_id uuid, p_payer uuid, p_amount bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when c.payments_paused then 'payments_paused'
    when coalesce((select sum(l.amount) from public.ledger_entries l
                   where l.deal_id = p_deal_id and l.kind = 'pay_in'), 0) + p_amount > c.max_deal_amount
      then 'cap_deal'
    when coalesce((select sum(l.amount) from public.ledger_entries l
                   where l.kind = 'pay_in' and l.from_account = 'ext:' || p_payer::text
                     and l.created_at > now() - interval '24 hours'), 0) + p_amount > c.max_customer_daily
      then 'cap_daily'
    when public.account_balance('hold') + p_amount > c.max_total_held then 'cap_total'
  end
  from public.platform_controls c;
$$;
revoke execute on function public.payin_check(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.payin_check(uuid, uuid, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Incidents (SOS + problem reports)
-- ---------------------------------------------------------------------------
create type public.incident_kind as enum ('sos', 'unsafe', 'harassment', 'theft', 'damage', 'scam', 'other');
create type public.incident_status as enum ('open', 'acknowledged', 'resolved');

create table public.incidents (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references public.deals (id),
  reporter_id      uuid not null references public.profiles (id),
  subject_id       uuid references public.profiles (id),          -- the other person on the task
  kind             public.incident_kind not null,
  note             text not null default '' check (length(note) <= 1000),
  lat              double precision check (lat between -90 and 90),
  lng              double precision check (lng between -180 and 180),
  accuracy_m       integer check (accuracy_m >= 0),
  status           public.incident_status not null default 'open',
  ops_note         text check (ops_note is null or length(ops_note) <= 1000),
  handled_by       uuid references public.profiles (id),
  alerts           integer not null default 1 check (alerts >= 1), -- repeated SOS presses fold in here
  last_alert_at    timestamptz not null default now(),
  ops_pinged_at    timestamptz,                                     -- last reminder push to Ops
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  location_purged_at timestamptz,
  created_at       timestamptz not null default now(),
  constraint resolved_has_note check (status <> 'resolved' or (ops_note is not null and resolved_at is not null))
);
create index incidents_open_idx on public.incidents (created_at) where status <> 'resolved';
create index incidents_reporter_idx on public.incidents (reporter_id, created_at);
-- one live SOS per person per task: pressing again updates it (new position, new alert)
create unique index incidents_one_live_sos on public.incidents (deal_id, reporter_id)
  where kind = 'sos' and status <> 'resolved';

alter table public.incidents enable row level security;
revoke all on public.incidents from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ops audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.ops_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid not null references public.profiles (id),
  action      text not null check (length(action) between 1 and 60),
  target      text check (target is null or length(target) <= 100),
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index ops_audit_created_idx on public.ops_audit_log (created_at desc);
alter table public.ops_audit_log enable row level security;
revoke all on public.ops_audit_log from anon, authenticated;

create function private.audit_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ops_audit_log is append-only';
end;
$$;
create trigger audit_no_change before update or delete on public.ops_audit_log
  for each row execute function private.audit_append_only();
create trigger audit_no_truncate before truncate on public.ops_audit_log
  for each statement execute function private.audit_append_only();
