-- Quick bundle (2026-11-22, owner "sure… I accept those"):
--   * first task free: a customer's first paid task has no service fee (Ops switch, default on)
--   * "want to raise the price?" nudge after this many minutes without an application (Ops setting)
--   * helpers rate customers: kept apart from helper ratings (a person can be both)
alter table public.pricing_settings add column first_task_free boolean not null default true;
alter table public.platform_rules
  add column nudge_after_minutes integer not null default 3 check (nudge_after_minutes between 1 and 120);

alter table public.profiles
  add column customer_rating_sum   integer not null default 0 check (customer_rating_sum >= 0),
  add column customer_rating_count integer not null default 0 check (customer_rating_count >= 0);

-- Which side a rating is about, so helper reviews never include what helpers said about customers.
alter table public.ratings add column about text not null default 'helper' check (about in ('helper', 'customer'));

-- The helper who did a finished job rates its customer, once (ratings is unique per deal + rater).
create function public.rate_customer(p_deal_id uuid, p_helper uuid, p_stars smallint, p_tags text[] default '{}', p_note text default null)
returns void language plpgsql set search_path = '' as $$
declare
  d public.deals;
begin
  if p_stars not between 1 and 5 then raise exception 'stars out of range' using errcode = '22023'; end if;
  select * into d from public.deals where id = p_deal_id for update;
  if not found or d.type <> 'errand' or d.status <> 'released' or d.helper_id is distinct from p_helper then
    raise exception 'this deal cannot be rated by this user' using errcode = 'PT409';
  end if;
  insert into public.ratings (deal_id, from_user_id, to_user_id, stars, tags, note, about)
  values (p_deal_id, p_helper, d.customer_id, p_stars, coalesce(p_tags, '{}'), nullif(trim(p_note), ''), 'customer');
  update public.profiles
     set customer_rating_sum = customer_rating_sum + p_stars, customer_rating_count = customer_rating_count + 1
   where id = d.customer_id;
  insert into public.timeline_events (deal_id, code, data)
  values (p_deal_id, 'customer_rated', jsonb_build_object('stars', p_stars));
end;
$$;
revoke execute on function public.rate_customer(uuid, uuid, smallint, text[], text) from public, anon, authenticated;
grant execute on function public.rate_customer(uuid, uuid, smallint, text[], text) to service_role;
