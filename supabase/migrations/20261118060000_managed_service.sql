-- Managed service (owner's V1 Master Spec, 2026-11-18, Part A1/C): the customer buys the errand
-- service from our business and prepays the full amount (price + shopping budget + "service &
-- safety fee"); the helper is an independent provider we pay per task. Their earnings are an amount
-- we owe, withdraw-only, paid to their own checked bank account (never a "wallet" or "balance").
--
-- This migration: the new settings (all Ops-editable), the switch of new tasks to the full-payment
-- mode, the withdrawal queue with its ledger entries, and the day-job safeguard.

-- 1. prices (spec C3/C4; owner split the middle tier: 1,500₮ under 30,000₮, 2,000₮ to 60,000₮)
alter table public.pricing_settings
  add column suggest_bps   integer not null default 12500  check (suggest_bps between 10000 and 30000),
  add column max_job_total integer not null default 200000 check (max_job_total between 5000 and 10000000),
  alter column service_fee_tiers set default '[{"below":10000,"fee":1000},{"below":30000,"fee":1500},{"below":60000,"fee":2000},{"below":null,"fee":3000}]';
update public.pricing_settings
   set service_fee_tiers = '[{"below":10000,"fee":1000},{"below":30000,"fee":1500},{"below":60000,"fee":2000},{"below":null,"fee":3000}]';

-- 2. rules (spec C5, C6, C10, A3)
alter table public.platform_rules
  add column payment_window_booked_minutes integer not null default 30    check (payment_window_booked_minutes between 5 and 240),
  add column withdraw_min                  integer not null default 3000  check (withdraw_min between 0 and 100000),
  add column withdrawals_per_day           integer not null default 2     check (withdrawals_per_day between 1 and 20),
  add column auto_payout_days              integer not null default 30    check (auto_payout_days between 1 and 365),
  -- day jobs stay one-off help, not a hidden job: one helper, one poster, at most this many in 30 days
  add column dayjob_pair_month_cap         integer not null default 8     check (dayjob_pair_month_cap between 1 and 31),
  alter column pay_mode set default 'held',
  alter column check_hours set default 3;
update public.platform_rules set pay_mode = 'held', check_hours = 3;

-- the per-task pay-in cap leaves room for the fee on top of the largest job total
update public.platform_controls set max_deal_amount = 210000;

-- 3. withdrawals (spec C10). Ledger: payable:<helper> → payout:<helper> when asked (the amount is
--    reserved), payout:<helper> → ext:<helper> when Ops has sent it, or back to payable if it failed.
alter table public.ledger_entries drop constraint valid_accounts;
alter table public.ledger_entries add constraint valid_accounts check (
  from_account ~ '^(hold|platform|(ext|payable|payout):[0-9a-f-]{36})$'
  and to_account ~ '^(hold|platform|(ext|payable|payout):[0-9a-f-]{36})$'
);

create table public.withdrawals (
  id             uuid primary key default gen_random_uuid(),
  helper_id      uuid not null references public.profiles (id) on delete restrict,
  amount         bigint not null check (amount > 0),
  reference      text not null unique check (reference ~ '^PAYOUT-[0-9A-F]{8}$'),
  -- where it goes, as it was when asked (a later account change never redirects this one)
  bank           text not null,
  account_number text not null,
  holder_name    text not null,
  status         text not null default 'requested' check (status in ('requested', 'sent', 'failed')),
  auto           boolean not null default false,
  requested_at   timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid references public.profiles (id),
  note           text check (note is null or length(note) <= 300),
  constraint withdrawals_decided check ((status = 'requested') = (decided_at is null))
);
create index withdrawals_queue_idx on public.withdrawals (requested_at) where status = 'requested';
create index withdrawals_helper_idx on public.withdrawals (helper_id, requested_at desc);
alter table public.withdrawals enable row level security;
revoke all on public.withdrawals from anon, authenticated;

-- what we owe a helper right now (released earnings not yet asked for)
create function public.payable_balance(p_user uuid)
returns bigint
language sql
stable
set search_path = ''
as $$ select public.account_balance('payable:' || p_user::text); $$;
revoke execute on function public.payable_balance(uuid) from public, anon, authenticated;
grant execute on function public.payable_balance(uuid) to service_role;

-- The helper asks for everything available (no partial amounts). Auto = the 30-day payout job.
create function public.request_withdrawal(p_helper uuid, p_auto boolean default false)
returns public.withdrawals
language plpgsql
set search_path = ''
as $$
declare
  r public.platform_rules;
  acct public.payout_accounts;
  v_amount bigint;
  v_today integer;
  w public.withdrawals;
  v_id uuid := gen_random_uuid();
begin
  perform 1 from public.profiles where id = p_helper for update; -- one request at a time per person
  select * into r from public.platform_rules where id;
  select * into acct from public.payout_accounts where user_id = p_helper;
  if not found or acct.verified_at is null then
    raise exception 'bank account not checked yet' using errcode = '23514';
  end if;
  v_amount := public.account_balance('payable:' || p_helper::text);
  if v_amount <= 0 or (not p_auto and v_amount < r.withdraw_min) then
    raise exception 'below the minimum withdrawal' using errcode = '23514';
  end if;
  if not p_auto then
    select count(*) into v_today from public.withdrawals
     where helper_id = p_helper and not auto
       and (requested_at at time zone 'Asia/Ulaanbaatar')::date = (now() at time zone 'Asia/Ulaanbaatar')::date;
    if v_today >= r.withdrawals_per_day then
      raise exception 'too many withdrawals today' using errcode = '23514';
    end if;
  end if;
  insert into public.withdrawals (id, helper_id, amount, reference, bank, account_number, holder_name, auto)
  values (v_id, p_helper, v_amount, 'PAYOUT-' || upper(substr(replace(v_id::text, '-', ''), 1, 8)), acct.bank, acct.account_number, acct.holder_name, p_auto)
  returning * into w;
  insert into public.ledger_entries (deal_id, kind, amount, from_account, to_account, provider_ref)
  values (null, 'withdrawal', v_amount, 'payable:' || p_helper::text, 'payout:' || p_helper::text, w.reference);
  return w;
end;
$$;

-- Ops sent it from the bank app (or it failed: the amount goes back to what we owe)
create function public.decide_withdrawal(p_id uuid, p_ops uuid, p_sent boolean, p_note text default null)
returns public.withdrawals
language plpgsql
set search_path = ''
as $$
declare
  w public.withdrawals;
begin
  select * into w from public.withdrawals where id = p_id for update;
  if not found or w.status <> 'requested' then
    raise exception 'this withdrawal was already handled' using errcode = 'PT409';
  end if;
  update public.withdrawals
     set status = case when p_sent then 'sent' else 'failed' end, decided_at = now(), decided_by = p_ops, note = nullif(trim(p_note), '')
   where id = p_id
   returning * into w;
  insert into public.ledger_entries (deal_id, kind, amount, from_account, to_account, provider_ref)
  values (null, 'withdrawal', w.amount, 'payout:' || w.helper_id::text,
          case when p_sent then 'ext:' else 'payable:' end || w.helper_id::text, w.reference);
  return w;
end;
$$;
revoke execute on function public.request_withdrawal(uuid, boolean), public.decide_withdrawal(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.request_withdrawal(uuid, boolean), public.decide_withdrawal(uuid, uuid, boolean, text) to service_role;

-- helpers whose oldest earnings not yet asked for are older than p_days (the 30-day automatic payout)
create function public.due_auto_payouts(p_days integer)
returns table (helper_id uuid)
language sql
stable
set search_path = ''
as $$
  with credit as (
    select substr(l.to_account, 9)::uuid as helper_id, l.created_at
    from public.ledger_entries l
    where l.to_account like 'payable:%'
  ),
  last_ask as (
    select w.helper_id, max(w.requested_at) as at from public.withdrawals w group by w.helper_id
  )
  select c.helper_id
  from credit c
  left join last_ask a on a.helper_id = c.helper_id
  where a.at is null or c.created_at > a.at
  group by c.helper_id
  having min(c.created_at) < now() - make_interval(days => p_days)
     and public.account_balance('payable:' || c.helper_id::text) > 0;
$$;
revoke execute on function public.due_auto_payouts(integer) from public, anon, authenticated;
grant execute on function public.due_auto_payouts(integer) to service_role;

-- 4. day jobs stay one-off help (spec A3): the same poster can't book the same helper for more
--    than dayjob_pair_month_cap day jobs in 30 days — regular daily work for one poster is a job.
create function private.dayjob_pair_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cap integer := coalesce((select dayjob_pair_month_cap from public.platform_rules where id), 8);
begin
  if new.type = 'errand' and new.category = 'dayjob' and new.helper_id is not null and new.helper_id is distinct from old.helper_id
     and (select count(*) from public.deals d
           where d.id <> new.id and d.type = 'errand' and d.category = 'dayjob'
             and d.customer_id = new.customer_id and d.helper_id = new.helper_id
             and d.assigned_at > now() - interval '30 days'
             and d.status not in ('cancelled', 'expired', 'refunded')) >= v_cap then
    raise exception 'day job limit with this helper reached' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger deals_dayjob_pair before update on public.deals
  for each row execute function private.dayjob_pair_cap();
