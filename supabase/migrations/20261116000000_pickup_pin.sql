-- Pickup pin (docs/decisions.md 2026-11-16 "Maps connected"):
--   * Two-point tasks (shop, deliver, carry) can pin the pickup as well as the drop-off.
--   * With both pins, the engine computes the distance (straight line × road factor) instead of
--     trusting the customer's guess; the price follows from it.
--   * Fixed at posting: apply_transition never writes these columns.
-- insert_deal fills every deals column from the deal JSON, so it needs no change.

alter table public.deals
  add column pickup_lat double precision check (pickup_lat between -90 and 90),
  add column pickup_lng double precision check (pickup_lng between -180 and 180),
  add constraint deals_pickup_pin_pair check ((pickup_lat is null) = (pickup_lng is null));

-- "Nearby" is measured from where the helper starts: the pickup when pinned, else the task pin.
-- Same bodies as 20261113050000_dispatch.sql otherwise (signatures and grants unchanged).
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
    -- the helper goes to the pickup first when there is one
    select id, category, customer_id, coalesce(pickup_lat, lat) as lat, coalesce(pickup_lng, lng) as lng
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

create or replace function public.nearby_open_deals(p_helper_id uuid, p_now timestamptz default now())
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
    -- the helper goes to the pickup first when there is one
    join (
      select x.id, x.category, x.customer_id, coalesce(x.pickup_lat, x.lat) as lat, coalesce(x.pickup_lng, x.lng) as lng
      from public.deals x where x.type = 'errand' and x.status = 'open'
    ) d on d.category = any (me.categories) and d.customer_id <> me.id
  )
  select c.id, c.km from c
  where c.km is null or c.radius_km is null or c.km <= c.radius_km
  order by c.km nulls last
  limit 50;
$$;
