-- 2026-11-26 (owner, after studying PleaseHelp): "I do like the age range thing"; experience and
-- how a helper gets around on the profile; and customers verified by ID for jobs in someone's home.

-- 1) Helper profile extras. All optional; the age range is shown only when the helper switches it on.
alter table public.profiles
  add column experience_years smallint
    check (experience_years is null or experience_years between 0 and 60),
  add column transport text[] not null default '{}'
    check (transport <@ array['walk', 'bicycle', 'motorbike', 'car']::text[]),
  -- the decade of the verified birth date, set when Ops approves an ID (the date itself is deleted after 30 days)
  add column age_band smallint
    check (age_band is null or age_band in (18, 20, 30, 40, 50, 60)),
  add column show_age_band boolean not null default false;

-- 2) A customer's identity check reuses the helper ID review: same files, same Ops queue, same 30-day
-- deletion. An 'identity' application verifies the person and nothing else (no helper role, no kinds).
alter table public.helper_applications
  add column purpose text not null default 'helper' check (purpose in ('helper', 'identity'));
alter table public.helper_applications drop constraint if exists helper_applications_categories_check;
alter table public.helper_applications
  add constraint helper_applications_categories_check
  check (purpose = 'identity' or cardinality(categories) between 1 and 6);
