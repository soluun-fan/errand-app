-- A worker must have a bank account before working (owner, 2026-11-18: "the user has to put their
-- bank account to even log in as a worker"). In the fee-only mode the customer pays the helper
-- directly into that account, so a helper without one can't be paid.
--
-- Sign-up already asks for it (helper_applications → payout_accounts); this closes the gaps for
-- helpers approved without one: they aren't notified, don't see the nearby feed and can't apply.
-- The app shows them an "add your bank account" step instead of jobs.

create function private.has_payout(p_user uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.payout_accounts a where a.user_id = p_user);
$$;
revoke execute on function private.has_payout(uuid) from public;
grant execute on function private.has_payout(uuid) to service_role;

-- applying (and being chosen, which needs an application) needs a bank account
create function private.offer_needs_payout()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.has_payout(new.helper_id) then
    raise exception 'add your bank account first' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger offers_payout before insert on public.offers
  for each row execute function private.offer_needs_payout();

-- notifications and the nearby feed: only helpers with a bank account (same as before otherwise)
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
      and private.has_payout(p.id)
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
      and private.has_payout(p.id)
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
