-- Landing page trust (owner, 2026-11-25, after studying PleaseHelp: "then do those").
--
-- 1. Company details for the public footer, filled in by Ops next to the support channels
--    (/ops/support). Any may stay empty; an empty one is not shown.
-- 2. public_stats(): the real totals behind the landing page's numbers band — finished jobs,
--    approved helpers, customer reviews of helpers and their average. The app shows the band only
--    once the numbers are big enough (src/lib/public-snapshot.ts); nothing is invented or rounded up.
--    The pilot's "[verify]" test tasks never count. Server-only, like the other public snapshots.
-- 3. work_photos.show_price: a finished-work card may show what the job cost only if the customer
--    agreed under wording that says so. Photos agreed before this migration were promised "only the
--    kind of job is shown", so they stay false.

alter table public.support_settings
  add column company_name    text check (company_name is null or length(company_name) <= 120),
  add column company_reg_no  text check (company_reg_no is null or length(company_reg_no) <= 40),
  add column company_address text check (company_address is null or length(company_address) <= 200);

alter table public.work_photos add column show_price boolean not null default false;

create or replace function public.public_stats()
returns table (done bigint, helpers bigint, reviews bigint, avg_stars numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.deals d
      where d.type = 'errand' and d.status = 'released' and d.title not ilike '[verify]%'),
    (select count(*) from public.profiles p
      where p.role = 'helper' and p.helper_status = 'approved'
        and (p.suspended_until is null or p.suspended_until <= now())),
    count(r.id),
    round(avg(r.stars)::numeric, 1)
  from public.ratings r
  join public.deals d on d.id = r.deal_id
  -- the customer's review of the helper (not the helper's review of the customer)
  where r.to_user_id = d.helper_id and r.from_user_id = d.customer_id
    and d.title not ilike '[verify]%';
$$;

revoke all on function public.public_stats() from public, anon, authenticated;
grant execute on function public.public_stats() to service_role;
