-- Keep only an adult-age attestation on profiles; stop collecting exact birth dates for onboarding.
alter table public.profiles
  add column if not exists age_confirmed_at timestamptz,
  add column test_helper boolean not null default false;

update public.profiles
set age_confirmed_at = coalesce(age_confirmed_at, now())
where birth_date is not null;

drop trigger profiles_adult on public.profiles;
drop function private.profiles_adult();
alter table public.profiles drop column birth_date;

-- A private test helper can accept jobs without a payout account. Actual withdrawals still require
-- a real payout account and remain unavailable to these accounts.
create or replace function private.has_payout(p_user uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.payout_accounts a where a.user_id = p_user)
      or exists (select 1 from public.profiles p where p.id = p_user and p.test_helper);
$$;
