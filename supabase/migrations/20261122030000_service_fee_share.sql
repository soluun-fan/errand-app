-- Service fee as a share of the helper's price (2026-11-22, docs/decisions.md "Service fee"; owner
-- chose option A): 10% of the price, rounded to 100₮, at least 500₮, at most 5,000₮, nothing on the
-- shopping money. Helpers keep 100%. service_fee_bps = 0 returns to the flat steps (service_fee_tiers).
-- Tasks already posted keep the fee saved on them.
alter table public.pricing_settings
  add column service_fee_bps integer not null default 1000 check (service_fee_bps between 0 and 3000),
  add column service_fee_min integer not null default 500  check (service_fee_min between 0 and 100000),
  add column service_fee_max integer not null default 5000 check (service_fee_max between 0 and 1000000),
  add constraint pricing_service_fee_range check (service_fee_min <= service_fee_max);
