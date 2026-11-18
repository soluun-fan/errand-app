-- Task conditions (owner, 2026-11-18: "follow schedule and time, or to have driver id, and be able to
-- discuss before deciding to accept … perhaps call"; picked: driver's licence / own car, talk first,
-- on-time record, background-checked only, languages, handover code).
--
-- A task's conditions live in deals.details->'require' (set at posting, never changed):
--   driver, car, checked, onTime, call, handoverCode: booleans; language: one code.
-- Only helpers who meet them are notified, see the task in their nearby feed, may apply and may be
-- chosen — checked here by private.meets_conditions(), the same rule the engine uses.

-- 1. verified driver's licence / own car (Ops checks the document, like certificates)
create table public.helper_badges (
  id           uuid primary key default gen_random_uuid(),
  helper_id    uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('driver', 'car')),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  doc_path     text not null check (length(doc_path) between 5 and 300),
  info         jsonb not null default '{}' check (jsonb_typeof(info) = 'object'),
  expires_on   date,
  review_note  text check (review_note is null or length(review_note) <= 500),
  reviewed_by  uuid references public.profiles (id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create unique index helper_badges_one_active on public.helper_badges (helper_id, kind) where status in ('pending', 'approved');
create index helper_badges_pending_idx on public.helper_badges (created_at) where status = 'pending';

-- 2. languages a helper speaks (self-declared, shown as such)
alter table public.profiles
  add column languages text[] not null default '{}'
    check (languages <@ array['en', 'ru', 'zh', 'ko', 'ja', 'de', 'kk']::text[] and cardinality(languages) <= 7);

-- 3. handover code: the customer's 4 digits; the helper finishes only after entering them
create table public.handover_codes (
  deal_id         uuid primary key references public.deals (id) on delete cascade,
  code            text not null check (code ~ '^[0-9]{4}$'),
  verified_at     timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz
);

alter table public.helper_badges enable row level security;
alter table public.handover_codes enable row level security;
revoke all on public.helper_badges, public.handover_codes from anon, authenticated;

-- 4. on time: of the helper's last 20 booked-for-later jobs they started, the share started within
--    10 minutes of the agreed time. Fewer than 3 such jobs = no record yet (they may still take it).
create function private.on_time_stats(p_helper uuid)
returns table (jobs integer, on_time integer)
language sql
stable
set search_path = ''
as $$
  with s as (
    select d.scheduled_at, min(e.created_at) as started_at
    from public.deals d
    join public.timeline_events e on e.deal_id = d.id and e.code = 'started'
    where d.helper_id = p_helper and d.type = 'errand' and d.scheduled_at is not null
    group by d.id, d.scheduled_at
    order by d.scheduled_at desc
    limit 20
  )
  select count(*)::integer, count(*) filter (where started_at <= scheduled_at + interval '10 minutes')::integer from s;
$$;

create function private.on_time_ok(p_helper uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select jobs < 3 or on_time * 10 >= jobs * 9 from private.on_time_stats(p_helper);
$$;

create function private.meets_conditions(p_helper uuid, p_require jsonb, p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    (coalesce((p_require ->> 'driver')::boolean, false) = false or exists (
      select 1 from public.helper_badges b where b.helper_id = p_helper and b.kind = 'driver' and b.status = 'approved'
        and (b.expires_on is null or b.expires_on >= (p_now at time zone 'Asia/Ulaanbaatar')::date)))
    and (coalesce((p_require ->> 'car')::boolean, false) = false or exists (
      select 1 from public.helper_badges b where b.helper_id = p_helper and b.kind = 'car' and b.status = 'approved'
        and (b.expires_on is null or b.expires_on >= (p_now at time zone 'Asia/Ulaanbaatar')::date)))
    and (coalesce((p_require ->> 'checked')::boolean, false) = false or exists (
      select 1 from public.profiles p where p.id = p_helper and p.kyc_level >= 4))
    and (nullif(p_require ->> 'language', '') is null or exists (
      select 1 from public.profiles p where p.id = p_helper and (p_require ->> 'language') = any (p.languages)))
    and (coalesce((p_require ->> 'onTime')::boolean, false) = false or private.on_time_ok(p_helper));
$$;
revoke execute on function private.on_time_stats(uuid), private.on_time_ok(uuid), private.meets_conditions(uuid, jsonb, timestamptz) from public;
-- the server (and the triggers it fires) may use them; nobody else
grant execute on function private.on_time_stats(uuid), private.on_time_ok(uuid), private.meets_conditions(uuid, jsonb, timestamptz) to service_role;

-- the app reads a helper's on-time record (server only)
create function public.helper_on_time(p_helper uuid)
returns table (jobs integer, on_time integer)
language sql
stable
set search_path = ''
as $$ select * from private.on_time_stats(p_helper); $$;
revoke execute on function public.helper_on_time(uuid) from public, anon, authenticated;
grant execute on function public.helper_on_time(uuid) to service_role;

-- 5. applying and being chosen: the database checks the conditions too
create function private.offer_meets_conditions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.meets_conditions(new.helper_id, (select d.details -> 'require' from public.deals d where d.id = new.deal_id)) then
    raise exception 'helper does not meet this task''s conditions' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger offers_conditions before insert on public.offers
  for each row execute function private.offer_meets_conditions();

create function private.assignment_meets_conditions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'errand' and new.helper_id is not null and new.helper_id is distinct from old.helper_id
     and not private.meets_conditions(new.helper_id, new.details -> 'require') then
    raise exception 'helper does not meet this task''s conditions' using errcode = '23514';
  end if;
  -- a handover code: the job can only be marked done after the helper entered the right code
  if new.status = 'check' and old.status = 'in_progress'
     and coalesce((new.details -> 'require' ->> 'handoverCode')::boolean, false)
     and not exists (select 1 from public.handover_codes h where h.deal_id = new.id and h.verified_at is not null) then
    raise exception 'enter the handover code first' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger deals_conditions before update on public.deals
  for each row execute function private.assignment_meets_conditions();

-- 6. "talk first" on any task: the same call rule care work has (an answered call of at least
--    care_call_min_seconds with that helper, written by the server)
create or replace function private.care_call_done()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_min integer := coalesce((select care_call_min_seconds from public.platform_rules where id), 30);
begin
  if new.type = 'errand' and new.helper_id is not null and new.helper_id is distinct from old.helper_id
     and (coalesce((select trust from public.category_settings where category = new.category), 'open') = 'care'
          or coalesce((new.details -> 'require' ->> 'call')::boolean, false))
     and not exists (
       select 1 from public.messages m
       where m.deal_id = new.id and m.helper_id = new.helper_id and m.is_system
         and m.text ~ '^call:ended:(voice|video):[0-9]+$'
         and split_part(m.text, ':', 4)::integer >= v_min
     ) then
    raise exception 'talk to the helper on a call first' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- 7. notifications and the nearby feed reach only helpers who meet the conditions
create or replace function public.dispatch_candidates(p_deal_id uuid, p_max_km double precision, p_now timestamptz default now())
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
    select id, category, customer_id, details -> 'require' as req, coalesce(pickup_lat, lat) as lat, coalesce(pickup_lng, lng) as lng
    from public.deals where id = p_deal_id and type = 'errand'
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
      and private.helper_can_take(p.id, d.category, p_now)
      and private.meets_conditions(p.id, d.req, p_now)
      and p.id <> d.customer_id
    join public.helper_presence hp on hp.user_id = p.id and hp.online and hp.updated_at > p_now - interval '10 minutes'
  )
  select c.id, c.km, c.rating_sum, c.rating_count, c.completed_count,
    (select count(*) from public.dispatch_offers o where o.helper_id = c.id and o.sent_at > p_now - interval '30 days'),
    (select count(*) from public.dispatch_offers o where o.helper_id = c.id and o.status = 'won' and o.sent_at > p_now - interval '30 days')
  from c
  where (c.km is null and p_max_km >= 1000) or (c.km is not null and c.km <= p_max_km and c.km <= c.radius_km);
$$;

create or replace function public.nearby_open_deals(p_helper_id uuid, p_now timestamptz default now())
returns table (deal_id uuid, distance_km double precision)
language sql
stable
set search_path = ''
as $$
  with me as (
    select p.id, hp.lat, hp.lng, hp.radius_km
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
      me.radius_km,
      d.invited_helper_id = me.id as invited
    from me
    join (
      select x.id, x.category, x.customer_id, x.details -> 'require' as req, coalesce(x.pickup_lat, x.lat) as lat, coalesce(x.pickup_lng, x.lng) as lng,
        x.invited_helper_id, x.invite_until, x.invite_open_after
      from public.deals x where x.type = 'errand' and x.status = 'open'
    ) d on d.customer_id <> me.id
      and private.helper_can_take(me.id, d.category, p_now)
      and private.meets_conditions(me.id, d.req, p_now)
      and (d.invited_helper_id is null or d.invited_helper_id = me.id
           or (d.invite_open_after and d.invite_until <= p_now))
  )
  select c.id, c.km from c
  where c.invited or c.km is null or c.radius_km is null or c.km <= c.radius_km
  order by c.invited desc, c.km nulls last
  limit 50;
$$;
