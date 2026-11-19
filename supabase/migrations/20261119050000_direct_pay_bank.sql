-- Direct-pay customers need an actual bank destination, including in a helper pilot.
create function private.can_receive_job(p_user uuid, p_pay_mode text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.payout_accounts where user_id = p_user)
    or (p_pay_mode = 'held' and current_user = 'service_role'
      and coalesce(nullif(current_setting('request.headers', true),'')::jsonb->>'x-helper-pilot','false') = 'true'
      and exists (select 1 from public.profiles where id = p_user and test_helper));
$$;
revoke all on function private.can_receive_job(uuid,text) from public;
grant execute on function private.can_receive_job(uuid,text) to service_role;

create or replace function private.offer_needs_payout() returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.can_receive_job(new.helper_id, (select pay_mode from public.deals where id = new.deal_id)) then
    raise exception 'add your bank account first' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.direct_match_needs_bank() returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.can_receive_job(new.helper_id, 'direct') then
    raise exception 'add your bank account first' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger direct_match_needs_bank before update on public.deals for each row
  when (new.pay_mode = 'direct' and new.helper_id is not null and new.helper_id is distinct from old.helper_id)
  execute function private.direct_match_needs_bank();

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
    select id, pay_mode, category, customer_id, details -> 'require' as req, coalesce(pickup_lat, lat) as lat, coalesce(pickup_lng, lng) as lng
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
      and private.can_receive_job(p.id, d.pay_mode)
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
      select x.id, x.pay_mode, x.category, x.customer_id, x.details -> 'require' as req, coalesce(x.pickup_lat, x.lat) as lat, coalesce(x.pickup_lng, x.lng) as lng,
        x.invited_helper_id, x.invite_until, x.invite_open_after
      from public.deals x where x.type = 'errand' and x.status = 'open'
    ) d on d.customer_id <> me.id
      and private.can_receive_job(me.id, d.pay_mode)
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
