-- Category durations and review windows are editable alongside category prices.
-- Existing deals keep their saved duration and check_hours.
alter table public.category_settings
  add column default_minutes integer not null default 30
    check (default_minutes between 30 and 480 and default_minutes % 30 = 0),
  add column check_hours integer check (check_hours between 2 and 168);

update public.category_settings set default_minutes = case
  when category in ('queue', 'repair', 'other', 'assembly', 'plumbing', 'electrical') then 60
  when category in ('escort', 'cleaning') then 120
  when category in ('childcare', 'eldercare') then 180
  when category = 'dayjob' then 240
  else 30 end;
update public.category_settings set check_hours = 72 where category in ('plumbing', 'electrical');
