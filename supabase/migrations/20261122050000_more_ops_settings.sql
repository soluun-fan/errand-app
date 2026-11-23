-- Remaining operational limits move from code to Ops settings (2026-11-22, owner: "all the hardcodes
-- should be moved to backends and database"). Defaults are today's values, so nothing changes until
-- Ops edits them. Code keeps the same numbers only as a fallback if the row can't be read.
alter table public.platform_rules
  add column max_pending_applications integer not null default 3  check (max_pending_applications between 1 and 20),
  add column ready_position_minutes   integer not null default 15 check (ready_position_minutes between 1 and 120),
  add column sos_reping_minutes       integer not null default 2  check (sos_reping_minutes between 1 and 30),
  add column sos_reping_for_minutes   integer not null default 30 check (sos_reping_for_minutes between 5 and 240),
  add column chat_retention_days      integer not null default 90 check (chat_retention_days between 7 and 730);

alter table public.pricing_settings
  add column night_start_hour integer not null default 22 check (night_start_hour between 0 and 23),
  add column night_end_hour   integer not null default 7  check (night_end_hour between 0 and 23);
