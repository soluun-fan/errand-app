-- Lower starting prices (owner, 2026-11-24: "the tur ajil one -- it should be 4k per hour at least
-- … many works could be lowered to either 3-4k starter -- cuz it really depends on what kind of work
-- and how close how easy the job is"). These are floors only: the customer still names the price,
-- the trip, night extra and stairs are still added, and Ops can change every value at /ops/pricing.
--
-- Rule of thumb: about 4,000₮ per hour of expected work, 3,000₮ for quick (~30 min) jobs, a bit
-- more where it's heavy or needs tools. Licensed work (plumbing, electrical, cleaning) and care
-- keep their minimums.

-- the general minimum (kinds without their own: queue, other)
update public.pricing_settings set base_fee = 4000 where base_fee = 5000;

update public.category_settings set min_fee = 3000, min_hourly = null where category in ('trash', 'shop', 'deliver');
update public.category_settings set min_fee = 4000, min_hourly = null where category = 'repair';
update public.category_settings set min_fee = 5000, min_hourly = null where category = 'assembly';
update public.category_settings set min_fee = 6000, min_hourly = null where category = 'carry';
update public.category_settings set min_fee = 8000, min_hourly = null where category = 'escort'; -- ~2 hours
update public.category_settings set min_fee = null, min_hourly = 4000 where category = 'dayjob';
