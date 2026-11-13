-- Tuslamj Hub — initial schema.
--
-- Design notes
-- * The deal engine (src/lib/engine) decides every state change. The database is the
--   second line of defence: it rejects illegal status jumps, out-of-balance money and
--   edits to the ledger, even if application code has a bug.
-- * Clients never write deals, ledger or events directly. Server code calls
--   insert_deal() / apply_transition() with the service role, inside one transaction.
-- * Money is bigint tögrög. Never numeric/float.

-- ============================================================================
-- Types
-- ============================================================================

create type public.user_role as enum ('customer', 'helper', 'admin');
create type public.helper_status as enum ('pending', 'approved', 'rejected');
create type public.category as enum ('shop', 'carry', 'queue', 'deliver', 'repair', 'other');
create type public.deal_type as enum ('errand', 'goods');
create type public.deal_mode as enum ('now', 'schedule');
create type public.deal_status as enum (
  'awaiting_payment', 'open', 'matched', 'in_progress', 'held',
  'check', 'disputed', 'released', 'refunded', 'cancelled', 'expired'
);
create type public.dispute_outcome as enum ('release', 'refund');
create type public.proof_kind as enum ('receipt', 'handover');
create type public.ledger_kind as enum (
  'pay_in', 'release_fee', 'item_reimburse', 'budget_refund', 'platform_fee',
  'release_seller', 'cancel_fee', 'refund', 'withdrawal'
);

-- ============================================================================
-- Profiles (1:1 with auth.users)
-- ============================================================================

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  name                text not null default '',
  phone               text unique,
  role                public.user_role not null default 'customer',
  -- 1 basic (phone) · 2 ДАН verified · 3 helper · 4 trusted   (CLAUDE.md §5)
  kyc_level           smallint not null default 1 check (kyc_level between 1 and 4),
  helper_status       public.helper_status,              -- null = never applied
  verified_name       text,                              -- legal name from ДАН
  categories          public.category[] not null default '{}',
  area                text,
  rating_sum          integer not null default 0 check (rating_sum >= 0),
  rating_count        integer not null default 0 check (rating_count >= 0),
  completed_count     integer not null default 0 check (completed_count >= 0),
  payout_bank         text,
  payout_account_last4 text check (payout_account_last4 ~ '^[0-9]{4}$'),
  payout_holder_name  text,
  suspended_until     timestamptz,
  created_at          timestamptz not null default now()
);

comment on column public.profiles.verified_name is 'Name returned by ДАН; payouts only go to accounts in this name.';

-- Create a profile for every new auth user (phone sign-up).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, phone, name)
  values (new.id, new.phone, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Deals (errands and SafePay goods deals share one table and one engine)
-- ============================================================================

create table public.deals (
  id                    uuid primary key default gen_random_uuid(),
  version               integer not null default 0 check (version >= 0),
  type                  public.deal_type not null,
  status                public.deal_status not null default 'awaiting_payment',
  title                 text not null check (length(trim(title)) > 0),
  description           text not null default '',

  -- errand
  category              public.category,
  mode                  public.deal_mode,
  scheduled_at          timestamptz,
  address               text,
  lat                   double precision,
  lng                   double precision,
  item_budget           bigint check (item_budget >= 0),
  fee                   bigint check (fee >= 0),
  service_fee           bigint check (service_fee >= 0),
  commission_bps        integer check (commission_bps between 0 and 10000),
  cancel_fee            bigint check (cancel_fee >= 0),
  max_applicants        integer check (max_applicants > 0),
  match_window_minutes  integer check (match_window_minutes > 0),
  customer_id           uuid references public.profiles (id),
  helper_id             uuid references public.profiles (id),
  match_by              timestamptz,
  receipt_amount        bigint check (receipt_amount >= 0),
  handover_proof_at     timestamptz,

  -- goods (SafePay)
  price                 bigint check (price >= 0),
  buyer_fee             bigint check (buyer_fee >= 0),
  seller_id             uuid references public.profiles (id),
  buyer_id              uuid references public.profiles (id),
  code                  text unique check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}$'),
  handed_over_at        timestamptz,

  -- money + timing
  held_amount           bigint not null default 0 check (held_amount >= 0),
  payment_ref           text unique,
  check_hours           integer not null check (check_hours > 0),
  check_until           timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint errand_fields check (
    type <> 'errand' or (
      category is not null and mode is not null and address is not null
      and item_budget is not null and fee is not null and service_fee is not null
      and commission_bps is not null and cancel_fee is not null and max_applicants is not null
      and match_window_minutes is not null and customer_id is not null
      and price is null and seller_id is null and buyer_id is null and code is null
    )
  ),
  constraint goods_fields check (
    type <> 'goods' or (
      price is not null and buyer_fee is not null and seller_id is not null and code is not null
      and customer_id is null and helper_id is null and category is null
    )
  ),
  constraint status_matches_type check (
    (type = 'errand' and status <> 'held')
    or (type = 'goods' and status not in ('open', 'matched', 'in_progress', 'expired'))
  ),
  constraint closed_deals_hold_nothing check (
    status not in ('released', 'refunded', 'cancelled', 'expired') or held_amount = 0
  ),
  constraint no_self_dealing check (
    (helper_id is null or helper_id <> customer_id) and (buyer_id is null or buyer_id <> seller_id)
  )
);

create index deals_customer_idx on public.deals (customer_id) where customer_id is not null;
create index deals_helper_idx on public.deals (helper_id) where helper_id is not null;
create index deals_seller_idx on public.deals (seller_id) where seller_id is not null;
create index deals_buyer_idx on public.deals (buyer_id) where buyer_id is not null;
create index deals_feed_idx on public.deals (category, created_at desc) where status = 'open';
-- background jobs: auto-release and no-match expiry
create index deals_check_due_idx on public.deals (check_until) where status = 'check';
create index deals_match_due_idx on public.deals (match_by) where status = 'open';

-- Mirror of the engine's state machine (CLAUDE.md §4). Same-status updates are allowed.
create function public.deal_status_allowed(t public.deal_type, s_from public.deal_status, s_to public.deal_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s_from = s_to or (t, s_from, s_to) in (
    ('errand', 'awaiting_payment', 'open'),
    ('errand', 'awaiting_payment', 'cancelled'),
    ('errand', 'open',             'matched'),
    ('errand', 'open',             'cancelled'),
    ('errand', 'open',             'expired'),
    ('errand', 'matched',          'in_progress'),
    ('errand', 'matched',          'cancelled'),
    ('errand', 'in_progress',      'check'),
    ('errand', 'in_progress',      'cancelled'),
    ('errand', 'check',            'released'),
    ('errand', 'check',            'disputed'),
    ('errand', 'disputed',         'released'),
    ('errand', 'disputed',         'refunded'),
    ('goods',  'awaiting_payment', 'held'),
    ('goods',  'awaiting_payment', 'cancelled'),
    ('goods',  'held',             'check'),
    ('goods',  'held',             'cancelled'),
    ('goods',  'check',            'released'),
    ('goods',  'check',            'disputed'),
    ('goods',  'disputed',         'released'),
    ('goods',  'disputed',         'refunded')
  )::boolean;
$$;

create function public.deals_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type <> old.type or new.id <> old.id then
    raise exception 'deal type and id are immutable';
  end if;
  if not public.deal_status_allowed(new.type, old.status, new.status) then
    raise exception 'illegal % transition: % -> %', new.type, old.status, new.status
      using errcode = 'PT409';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger deals_guard
  before update on public.deals
  for each row execute function public.deals_guard();

-- ============================================================================
-- Offers, disputes, proofs, messages, ratings, timeline
-- ============================================================================

create table public.offers (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals (id) on delete cascade,
  helper_id   uuid not null references public.profiles (id),
  note        text not null default '',
  created_at  timestamptz not null default now(),
  unique (deal_id, helper_id)
);

create table public.disputes (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null unique references public.deals (id) on delete cascade,
  opened_by   uuid not null references public.profiles (id),
  reason      text not null check (length(trim(reason)) > 0),
  note        text not null default '',
  outcome     public.dispute_outcome,
  decided_by  uuid references public.profiles (id),
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint decision_complete check ((outcome is null) = (decided_by is null) and (outcome is null) = (decided_at is null))
);

create table public.proofs (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references public.deals (id) on delete cascade,
  kind         public.proof_kind not null,
  file_path    text,                 -- path in the private "proofs" storage bucket
  amount       bigint check (amount >= 0),
  lat          double precision,
  lng          double precision,
  taken_at     timestamptz,
  uploaded_by  uuid not null references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index proofs_deal_idx on public.proofs (deal_id);

create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.deals (id) on delete cascade,
  from_user_id  uuid references public.profiles (id),   -- null for system messages
  text          text not null,
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  check (is_system or from_user_id is not null)
);
create index messages_deal_idx on public.messages (deal_id, created_at);

create table public.ratings (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.deals (id) on delete cascade,
  from_user_id  uuid not null references public.profiles (id),
  to_user_id    uuid not null references public.profiles (id),
  stars         smallint not null check (stars between 1 and 5),
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (deal_id, from_user_id)
);

create table public.timeline_events (
  id          bigint generated always as identity primary key,
  deal_id     uuid not null references public.deals (id) on delete cascade,
  code        text not null,           -- rendered in MN/EN by the UI
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index timeline_events_deal_idx on public.timeline_events (deal_id, id);

-- ============================================================================
-- Ledger (double entry, append-only)
-- ============================================================================
-- Accounts: 'ext:<user uuid>' (user's own bank), 'hold' (partner bank hold account),
-- 'payable:<user uuid>' (released, awaiting withdrawal), 'platform' (revenue).

create table public.ledger_entries (
  id            bigint generated always as identity primary key,
  deal_id       uuid references public.deals (id),
  kind          public.ledger_kind not null,
  amount        bigint not null check (amount > 0),
  from_account  text not null,
  to_account    text not null,
  provider_ref  text,
  created_at    timestamptz not null default now(),
  constraint distinct_accounts check (from_account <> to_account),
  constraint valid_accounts check (
    from_account ~ '^(hold|platform|(ext|payable):[0-9a-f-]{36})$'
    and to_account ~ '^(hold|platform|(ext|payable):[0-9a-f-]{36})$'
  ),
  constraint hold_entries_have_deal check (
    deal_id is not null or (from_account <> 'hold' and to_account <> 'hold')
  )
);
create index ledger_deal_idx on public.ledger_entries (deal_id);
create index ledger_to_idx on public.ledger_entries (to_account);
create index ledger_from_idx on public.ledger_entries (from_account);
-- Idempotent webhooks: one provider payment can only ever be booked once.
create unique index ledger_pay_in_ref_uniq on public.ledger_entries (provider_ref) where kind = 'pay_in';

create function public.ledger_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ledger_entries is append-only; post a correcting entry instead';
end;
$$;

create trigger ledger_no_update before update or delete on public.ledger_entries
  for each row execute function public.ledger_append_only();
create trigger ledger_no_truncate before truncate on public.ledger_entries
  for each statement execute function public.ledger_append_only();

-- Net balance of an account, optionally for one deal.
create function public.account_balance(p_account text, p_deal_id uuid default null)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when to_account = p_account then amount else 0 end), 0)
       - coalesce(sum(case when from_account = p_account then amount else 0 end), 0)
  from public.ledger_entries
  where (to_account = p_account or from_account = p_account)
    and (p_deal_id is null or deal_id = p_deal_id);
$$;

-- Global invariant check for Ops / monitoring: returns rows only when something is wrong.
create function public.ledger_invariant_violations()
returns table (deal_id uuid, held_amount bigint, ledger_hold bigint)
language sql
stable
set search_path = ''
as $$
  select d.id, d.held_amount, public.account_balance('hold', d.id)
  from public.deals d
  where d.held_amount <> public.account_balance('hold', d.id)
  union all
  select null, (select coalesce(sum(held_amount), 0) from public.deals)::bigint, public.account_balance('hold')
  where (select coalesce(sum(held_amount), 0) from public.deals) <> public.account_balance('hold');
$$;

-- ============================================================================
-- Writing transitions (server only)
-- ============================================================================

-- Inserts a freshly created deal (version 0) and its first timeline events.
create function public.insert_deal(p_deal jsonb, p_events jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.deals
  select (jsonb_populate_record(
    null::public.deals,
    p_deal || jsonb_build_object('version', 0, 'held_amount', 0, 'status', 'awaiting_payment', 'updated_at', now())
  )).*
  returning id into v_id;

  insert into public.timeline_events (deal_id, code, data, created_at)
  select v_id, e.code, coalesce(e.data, '{}'::jsonb), coalesce(e.created_at, now())
  from jsonb_to_recordset(p_events) as e(code text, data jsonb, created_at timestamptz);

  return v_id;
end;
$$;

-- Applies one engine transition atomically.
--   p_expected_version  the version the engine read; a mismatch means someone else
--                       changed the deal first → SQLSTATE PT409 (HTTP 409), caller retries.
--   p_deal              the deal row after the transition (only mutable columns are used)
--   p_new_offers        [{helper_id, note, created_at}]
--   p_dispute           full dispute row to upsert, or null if unchanged
--   p_events            [{code, data, created_at}]
--   p_ledger            [{kind, amount, from_account, to_account, provider_ref, created_at}]
--   p_suspend           [{user_id, until}] helper penalties
-- After writing, re-checks that this deal's hold balance in the ledger equals held_amount.
create function public.apply_transition(
  p_deal_id uuid,
  p_expected_version integer,
  p_deal jsonb,
  p_new_offers jsonb default '[]',
  p_dispute jsonb default null,
  p_events jsonb default '[]',
  p_ledger jsonb default '[]',
  p_suspend jsonb default '[]'
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r public.deals := jsonb_populate_record(null::public.deals, p_deal);
  v_version integer;
  v_held bigint;
  v_ledger_hold bigint;
begin
  update public.deals d set
    version           = d.version + 1,
    status            = r.status,
    held_amount       = r.held_amount,
    payment_ref       = r.payment_ref,
    check_until       = r.check_until,
    helper_id         = r.helper_id,
    match_by          = r.match_by,
    receipt_amount    = r.receipt_amount,
    handover_proof_at = r.handover_proof_at,
    buyer_id          = r.buyer_id,
    handed_over_at    = r.handed_over_at
  where d.id = p_deal_id and d.version = p_expected_version
  returning d.version, d.held_amount into v_version, v_held;

  if not found then
    raise exception 'deal % changed since version % (or does not exist)', p_deal_id, p_expected_version
      using errcode = 'PT409';
  end if;

  insert into public.offers (deal_id, helper_id, note, created_at)
  select p_deal_id, o.helper_id, coalesce(o.note, ''), coalesce(o.created_at, now())
  from jsonb_to_recordset(p_new_offers) as o(helper_id uuid, note text, created_at timestamptz);

  if p_dispute is not null and jsonb_typeof(p_dispute) = 'object' then
    insert into public.disputes (deal_id, opened_by, reason, note, outcome, decided_by, decided_at, created_at)
    select p_deal_id, x.opened_by, x.reason, coalesce(x.note, ''), x.outcome, x.decided_by, x.decided_at, coalesce(x.created_at, now())
    from jsonb_to_record(p_dispute) as x(
      opened_by uuid, reason text, note text, outcome public.dispute_outcome,
      decided_by uuid, decided_at timestamptz, created_at timestamptz
    )
    on conflict (deal_id) do update set
      outcome = excluded.outcome, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  end if;

  insert into public.timeline_events (deal_id, code, data, created_at)
  select p_deal_id, e.code, coalesce(e.data, '{}'::jsonb), coalesce(e.created_at, now())
  from jsonb_to_recordset(p_events) as e(code text, data jsonb, created_at timestamptz);

  insert into public.ledger_entries (deal_id, kind, amount, from_account, to_account, provider_ref, created_at)
  select p_deal_id, l.kind, l.amount, l.from_account, l.to_account, l.provider_ref, coalesce(l.created_at, now())
  from jsonb_to_recordset(p_ledger) as l(
    kind public.ledger_kind, amount bigint, from_account text, to_account text, provider_ref text, created_at timestamptz
  );

  update public.profiles p set suspended_until = greatest(p.suspended_until, s.until)
  from jsonb_to_recordset(p_suspend) as s(user_id uuid, until timestamptz)
  where p.id = s.user_id;

  v_ledger_hold := public.account_balance('hold', p_deal_id);
  if v_ledger_hold <> v_held then
    raise exception 'ledger hold % does not match held_amount % for deal %', v_ledger_hold, v_held, p_deal_id;
  end if;

  return v_version;
end;
$$;

-- ============================================================================
-- Row level security
-- ============================================================================

-- Helpers are security definer so policies can use them without recursing through RLS.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create function public.is_participant(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.deals d
    where d.id = p_deal_id
      and auth.uid() in (d.customer_id, d.helper_id, d.seller_id, d.buyer_id)
  ) or public.is_admin();
$$;

-- Open errands an approved, non-suspended helper may see in their feed.
create function public.can_see_in_feed(p_deal public.deals)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_deal.type = 'errand' and p_deal.status = 'open' and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'helper' and p.helper_status = 'approved'
      and (p.suspended_until is null or p.suspended_until < now())
      and p_deal.category = any (p.categories)
  );
$$;

alter table public.profiles        enable row level security;
alter table public.deals           enable row level security;
alter table public.offers          enable row level security;
alter table public.disputes        enable row level security;
alter table public.proofs          enable row level security;
alter table public.messages        enable row level security;
alter table public.ratings         enable row level security;
alter table public.timeline_events enable row level security;
alter table public.ledger_entries  enable row level security;

-- All writes go through server code with the service role. Clients only read
-- (plus editing their own display name / area).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant select on all tables in schema public to authenticated;
grant update (name, area) on public.profiles to authenticated;
grant execute on function public.is_admin(), public.is_participant(uuid), public.can_see_in_feed(public.deals)
  to authenticated;
grant execute on all functions in schema public to service_role;
-- Supabase grants anon/authenticated everything on new objects by default; keep future
-- migrations read-only for clients unless they grant explicitly.
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create policy "profiles: own row or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles: edit own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "deals: participants, admin, or helper feed" on public.deals
  for select to authenticated using (
    auth.uid() in (customer_id, helper_id, seller_id, buyer_id)
    or public.is_admin()
    or public.can_see_in_feed(deals)
    or exists (select 1 from public.offers o where o.deal_id = deals.id and o.helper_id = auth.uid())
  );

create policy "offers: own, deal customer, admin" on public.offers
  for select to authenticated using (helper_id = auth.uid() or public.is_participant(deal_id));

create policy "disputes: participants" on public.disputes
  for select to authenticated using (public.is_participant(deal_id));
create policy "proofs: participants" on public.proofs
  for select to authenticated using (public.is_participant(deal_id));
create policy "messages: participants" on public.messages
  for select to authenticated using (public.is_participant(deal_id));
create policy "ratings: participants" on public.ratings
  for select to authenticated using (public.is_participant(deal_id));
create policy "timeline: participants" on public.timeline_events
  for select to authenticated using (public.is_participant(deal_id));

create policy "ledger: own accounts or admin" on public.ledger_entries
  for select to authenticated using (
    public.is_admin()
    or from_account in ('ext:' || auth.uid(), 'payable:' || auth.uid())
    or to_account   in ('ext:' || auth.uid(), 'payable:' || auth.uid())
  );

-- Other people's profiles: only what a trust card needs. No phone numbers (anti off-platform).
-- Intentionally runs with the owner's rights (not security_invoker) so it can read past the
-- "own row" policy on profiles; it only exposes these columns.
create view public.public_profiles
with (security_barrier = true)
as
  select id, name, role, helper_status, kyc_level, categories, area,
         rating_count, completed_count,
         case when rating_count > 0 then round(rating_sum::numeric / rating_count, 1) end as rating
  from public.profiles;

grant select on public.public_profiles to authenticated;
