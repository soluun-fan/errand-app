-- Clears the Supabase security advisor findings on the initial schema.
--
-- 1. public_profiles was a SECURITY DEFINER view (it read past the "own row" policy on
--    profiles). Replace it with column-level privileges: signed-in users may read every
--    profile, but only the non-sensitive columns. Phone, ДАН name, payout account and
--    suspension stay server-only (service role).
-- 2. Move the SECURITY DEFINER helpers used by RLS policies out of the API-exposed
--    `public` schema into `private`, so they can't be called over the REST API.

-- ---------------------------------------------------------------------------
-- 1. RLS helpers → private schema
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Policies reference functions by OID, so they keep working after the move.
alter function public.is_admin() set schema private;
alter function public.is_participant(uuid) set schema private;
alter function public.can_see_in_feed(public.deals) set schema private;

-- is_participant's body named public.is_admin(); point it at the new location.
create or replace function private.is_participant(p_deal_id uuid)
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
  ) or private.is_admin();
$$;

-- ---------------------------------------------------------------------------
-- 2. Profiles: column privileges instead of a definer view
-- ---------------------------------------------------------------------------
-- `if exists`: the dashboard's advisor "autofix" may already have altered or dropped these.
drop view if exists public.public_profiles;

drop policy if exists "profiles: own row or admin" on public.profiles;
create policy "profiles: readable by signed-in users" on public.profiles
  for select to authenticated using (true);

revoke select on public.profiles from authenticated;
grant select (
  id, name, role, helper_status, kyc_level, categories, area,
  rating_sum, rating_count, completed_count, created_at
) on public.profiles to authenticated;

-- Convenience view for trust cards; runs with the caller's rights.
create view public.public_profiles
with (security_invoker = true)
as
  select id, name, role, helper_status, kyc_level, categories, area,
         rating_count, completed_count,
         case when rating_count > 0 then round(rating_sum::numeric / rating_count, 1) end as rating
  from public.profiles;

grant select on public.public_profiles to authenticated;
