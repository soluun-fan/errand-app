-- Minimum price per kind of work (owner, 2026-11-17: "taking out trash is easier than grocery
-- shopping, so … cheaper. and hard labor things should be set higher minimum price. and the shift
-- should account both hourly wage and duration"). The customer still names the price; this is only
-- the floor. A task's floor = its kind's minimum (or, for hourly kinds, the hourly floor × hours)
-- + the trip + the night extra; the engine computes it at posting and saves it on the task.
-- Null = the general minimum (pricing_settings.base_fee). Ops edits these at /ops/pricing.

alter table public.category_settings
  add column min_fee integer check (min_fee is null or min_fee between 1000 and 1000000),
  add column min_hourly integer check (min_hourly is null or min_hourly between 1000 and 200000),
  add constraint category_settings_one_floor check (min_fee is null or min_hourly is null);

-- starting values; Ops can change any of them
update public.category_settings set min_fee = 3000  where category = 'trash';
update public.category_settings set min_fee = 6000  where category = 'repair';
update public.category_settings set min_fee = 8000  where category = 'assembly';
update public.category_settings set min_fee = 10000 where category = 'carry';
update public.category_settings set min_fee = 15000 where category in ('plumbing', 'electrical');
update public.category_settings set min_fee = 20000 where category = 'cleaning';
update public.category_settings set min_hourly = 6000 where category = 'dayjob';
update public.category_settings set min_hourly = 8000 where category in ('childcare', 'eldercare');
