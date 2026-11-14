-- Pricing settings (docs/decisions.md 2026-11-15 "Pricing"): ONE row Ops changes from /ops/pricing,
-- no deploy needed. The engine's defaults (src/lib/engine/config.ts) are the starting values.
--   price = base (covers ~30 min within 1 km) + visible extras (time, distance, heavy, stairs, tools,
--   night, 2nd person, round trip); customer may move it −20%…+30%; helpers counter once, up to
--   +30%, never below; helpers keep 100%; customer pays a flat service fee by price tier.
-- Each deal snapshots what it needs at posting (service fee, recommended price, counter cap), so a
-- change here never alters a task that already exists.

create table public.pricing_settings (
  id                boolean primary key default true check (id), -- exactly one row
  base_fee          integer not null default 5000  check (base_fee between 1000 and 100000),
  included_minutes  integer not null default 30    check (included_minutes between 0 and 240 and included_minutes % 30 = 0),
  included_km       integer not null default 1     check (included_km between 0 and 20),
  per_half_hour     integer not null default 3000  check (per_half_hour between 0 and 100000),
  per_km            integer not null default 1500  check (per_km between 0 and 100000),
  heavy_fee         integer not null default 3000  check (heavy_fee between 0 and 100000),
  per_floor         integer not null default 1500  check (per_floor between 0 and 100000),
  tools_fee         integer not null default 2000  check (tools_fee between 0 and 100000),
  night_fee         integer not null default 1000  check (night_fee between 0 and 100000),
  round_trip_bps    integer not null default 5000  check (round_trip_bps between 0 and 10000),
  price_down_bps    integer not null default 2000  check (price_down_bps between 0 and 5000),
  price_up_bps      integer not null default 3000  check (price_up_bps between 0 and 10000),
  counter_up_bps    integer not null default 3000  check (counter_up_bps between 0 and 10000),
  -- [{below: number|null, fee: number}], ascending, last one open-ended (checked again in app code)
  service_fee_tiers jsonb not null default
    '[{"below":10000,"fee":500},{"below":30000,"fee":1000},{"below":100000,"fee":2000},{"below":null,"fee":3000}]'
    check (jsonb_typeof(service_fee_tiers) = 'array' and jsonb_array_length(service_fee_tiers) between 1 and 8),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id)
);
insert into public.pricing_settings default values;
alter table public.pricing_settings enable row level security;
revoke all on public.pricing_settings from anon, authenticated;

create trigger pricing_keep_row before delete on public.pricing_settings
  for each row execute function private.controls_keep_row();
create trigger pricing_no_truncate before truncate on public.pricing_settings
  for each statement execute function private.controls_keep_row();
