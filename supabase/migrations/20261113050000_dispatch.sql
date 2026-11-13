-- Decisions of 2026-11-13 (docs/decisions.md):
--   * Post free → a helper accepts (or the customer picks a quote) → the customer pays within
--     10 min and the bank holds it. New errand transitions: open → awaiting_payment → matched,
--     and awaiting_payment → open when a match lapses unpaid.
--   * UBCab-style dispatch: helpers go online with a radius; offers go out in waves.
--   * Custom-mode quotes: offers carry an optional price.

alter table public.deals add column posted_fee bigint check (posted_fee >= 0);
update public.deals set posted_fee = fee where type = 'errand';

alter table public.offers add column price bigint check (price is null or price >= 0);

create or replace function public.deal_status_allowed(t public.deal_type, s_from public.deal_status, s_to public.deal_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s_from = s_to or (t, s_from, s_to) in (
    ('errand', 'open',             'awaiting_payment'),
    ('errand', 'open',             'cancelled'),
    ('errand', 'open',             'expired'),
    ('errand', 'awaiting_payment', 'matched'),
    ('errand', 'awaiting_payment', 'open'),
    ('errand', 'awaiting_payment', 'cancelled'),
    ('errand', 'awaiting_payment', 'expired'),
    ('errand', 'open',             'matched'),   -- legacy deals paid at posting
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

-- New errands start "open" (posting is free).
create or replace function public.insert_deal(p_deal jsonb, p_events jsonb)
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
    p_deal || jsonb_build_object(
      'version', 0, 'held_amount', 0, 'updated_at', now(),
      -- errands are posted free and go straight to helpers; SafePay waits for the buyer's payment
      'status', case when p_deal->>'type' = 'errand' then 'open' else 'awaiting_payment' end
    )
  )).*
  returning id into v_id;

  insert into public.timeline_events (deal_id, code, data, created_at)
  select v_id, e.code, coalesce(e.data, '{}'::jsonb), coalesce(e.created_at, now())
  from jsonb_to_recordset(p_events) as e(code text, data jsonb, created_at timestamptz);

  return v_id;
end;
$$;

-- apply_transition v3: also writes fee / pay_by (they change when a helper is matched or a
-- match lapses) and deletes offers the transition dropped (p_removed_offers: [helper_id]).
drop function public.apply_transition(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);
create or replace function public.apply_transition(
  p_deal_id uuid,
  p_expected_version integer,
  p_deal jsonb,
  p_new_offers jsonb default '[]',
  p_removed_offers jsonb default '[]',
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
    item_budget       = r.item_budget,
    fee               = r.fee,
    pay_by            = r.pay_by,
    top_up            = r.top_up,
    handover_proof_at = r.handover_proof_at,
    buyer_id          = r.buyer_id,
    handed_over_at    = r.handed_over_at
  where d.id = p_deal_id and d.version = p_expected_version
  returning d.version, d.held_amount into v_version, v_held;

  if not found then
    raise exception 'deal % changed since version % (or does not exist)', p_deal_id, p_expected_version
      using errcode = 'PT409';
  end if;

  delete from public.offers o
  where o.deal_id = p_deal_id
    and o.helper_id in (select x::uuid from jsonb_array_elements_text(p_removed_offers) as x);

  insert into public.offers (deal_id, helper_id, note, price, created_at)
  select p_deal_id, o.helper_id, coalesce(o.note, ''), o.price, coalesce(o.created_at, now())
  from jsonb_to_recordset(p_new_offers) as o(helper_id uuid, note text, price bigint, created_at timestamptz);

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

revoke execute on function public.apply_transition(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.apply_transition(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Helper presence: online toggle, last known position, how far they'll go.
-- Written by server code only (after checking the signed-in helper); clients read their own row.
-- ---------------------------------------------------------------------------
create table public.helper_presence (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  online      boolean not null default false,
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  radius_km   real not null default 3 check (radius_km between 0.5 and 60),
  updated_at  timestamptz not null default now()
);
create index helper_presence_online_idx on public.helper_presence (updated_at) where online;
alter table public.helper_presence enable row level security;
create policy "helper_presence: own row" on public.helper_presence
  for select to authenticated using (user_id = auth.uid() or private.is_admin());

-- ---------------------------------------------------------------------------
-- Dispatch offers: who was pushed which task, in which wave, and what they did.
-- ---------------------------------------------------------------------------
create table public.dispatch_offers (
  deal_id      uuid not null references public.deals (id) on delete cascade,
  helper_id    uuid not null references public.profiles (id) on delete cascade,
  wave         smallint not null check (wave >= 0),
  distance_km  real,
  score        real not null,
  status       text not null default 'sent' check (status in ('sent', 'declined', 'won', 'closed')),
  sent_at      timestamptz not null default now(),
  expires_at   timestamptz not null,
  primary key (deal_id, helper_id)
);
create index dispatch_offers_helper_idx on public.dispatch_offers (helper_id, status, expires_at);
alter table public.dispatch_offers enable row level security;
create policy "dispatch_offers: own offers" on public.dispatch_offers
  for select to authenticated using (helper_id = auth.uid() or private.is_admin());

-- ---------------------------------------------------------------------------
-- Web Push subscriptions (one per browser/device).
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique check (endpoint like 'https://%'),
  p256dh      text not null,
  auth        text not null,
  locale      text not null default 'mn' check (locale in ('mn', 'en')),
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions: own" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Candidates for one dispatch wave: online (seen in the last 10 min), approved, not suspended,
-- doing this category, not the customer, within both the wave radius and their own radius.
-- Distance is great-circle (haversine) — plenty for a city; PostGIS can replace it later.
-- A task without a pin reaches everyone only in the city-wide wave (p_max_km >= 1000).
-- Returns the stats the scorer needs (src/lib/dispatch/plan.ts).
-- ---------------------------------------------------------------------------
create function public.dispatch_candidates(p_deal_id uuid, p_max_km double precision, p_now timestamptz default now())
returns table (
  helper_id uuid,
  distance_km double precision,
  rating_sum integer,
  rating_count integer,
  completed_count integer,
  offers_30d bigint,
  won_30d bigint
)
language sql
stable
set search_path = ''
as $$
  with d as (
    select id, category, customer_id, lat, lng from public.deals where id = p_deal_id and type = 'errand'
  ),
  c as (
    select p.id, p.rating_sum, p.rating_count, p.completed_count, hp.radius_km,
      case when d.lat is null or hp.lat is null then null else
        6371.0 * 2 * asin(sqrt(
          power(sin(radians(hp.lat - d.lat) / 2), 2) +
          cos(radians(d.lat)) * cos(radians(hp.lat)) * power(sin(radians(hp.lng - d.lng) / 2), 2)
        ))
      end as km
    from d
    join public.profiles p on p.role = 'helper' and p.helper_status = 'approved'
      and (p.suspended_until is null or p.suspended_until < p_now)
      and d.category = any (p.categories)
      and p.id <> d.customer_id
    join public.helper_presence hp on hp.user_id = p.id and hp.online and hp.updated_at > p_now - interval '10 minutes'
  )
  select c.id, c.km, c.rating_sum, c.rating_count, c.completed_count,
    (select count(*) from public.dispatch_offers o where o.helper_id = c.id and o.sent_at > p_now - interval '30 days'),
    (select count(*) from public.dispatch_offers o where o.helper_id = c.id and o.status = 'won' and o.sent_at > p_now - interval '30 days')
  from c
  where (c.km is null and p_max_km >= 1000) or (c.km is not null and c.km <= p_max_km and c.km <= c.radius_km);
$$;
revoke execute on function public.dispatch_candidates(uuid, double precision, timestamptz) from public;
grant execute on function public.dispatch_candidates(uuid, double precision, timestamptz) to service_role;

-- Which wave a task's dispatch has reached (one row per task; server-only).
create table public.dispatch_state (
  deal_id          uuid primary key references public.deals (id) on delete cascade,
  wave             smallint not null check (wave >= 0),
  wave_started_at  timestamptz not null,
  notified         integer not null default 0 check (notified >= 0)
);
alter table public.dispatch_state enable row level security;
create policy "dispatch_state: participants" on public.dispatch_state
  for select to authenticated using (private.is_participant(deal_id));

-- The helper's nearby feed: open tasks in their categories, nearest first, within their radius
-- (tasks without a pin are listed last). Same eligibility as dispatch_candidates.
create function public.nearby_open_deals(p_helper_id uuid, p_now timestamptz default now())
returns table (deal_id uuid, distance_km double precision)
language sql
stable
set search_path = ''
as $$
  with me as (
    select p.id, p.categories, hp.lat, hp.lng, hp.radius_km
    from public.profiles p
    left join public.helper_presence hp on hp.user_id = p.id
    where p.id = p_helper_id and p.role = 'helper' and p.helper_status = 'approved'
      and (p.suspended_until is null or p.suspended_until < p_now)
  ),
  c as (
    select d.id,
      case when d.lat is null or me.lat is null then null else
        6371.0 * 2 * asin(sqrt(
          power(sin(radians(me.lat - d.lat) / 2), 2) +
          cos(radians(d.lat)) * cos(radians(me.lat)) * power(sin(radians(me.lng - d.lng) / 2), 2)
        ))
      end as km,
      me.radius_km
    from me
    join public.deals d on d.type = 'errand' and d.status = 'open'
      and d.category = any (me.categories) and d.customer_id <> me.id
  )
  select c.id, c.km from c
  where c.km is null or c.radius_km is null or c.km <= c.radius_km
  order by c.km nulls last
  limit 50;
$$;
revoke execute on function public.nearby_open_deals(uuid, timestamptz) from public;
grant execute on function public.nearby_open_deals(uuid, timestamptz) to service_role;

-- Saved addresses can carry their map pin.
alter table public.saved_addresses
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180);

-- Clients read (RLS limits rows); all writes go through server code with the service role.
revoke all on public.helper_presence, public.dispatch_offers, public.dispatch_state, public.push_subscriptions from anon, authenticated;
grant select on public.helper_presence, public.dispatch_offers, public.dispatch_state, public.push_subscriptions to authenticated;
