-- Helper standards (2026-11-22, docs/decisions.md "Helper standards"). Owner: "workers are
-- lackluster… take a firm and careful approach; location tracking is necessary".
--
--   * Ops settings (platform_rules) for every new limit.
--   * Location is required during a job: sharing with the task's customer switches on when the job
--     starts and can't be switched off while it runs (it still stops when the job ends).
--   * The route during a job is kept as points for disputes, deleted after route_retention_days.
--   * Marks: one per late job (engine events `helper_late` / `helper_no_show`). Marks in the window
--     build a ladder: warning (app) → ranked lower (app) → pause → paused until Ops reviews.
--     Ops can void a mark (e.g. after an appeal); customer-caused delays are Ops' call.

alter table public.platform_rules
  add column arrive_minutes           integer not null default 45  check (arrive_minutes between 5 and 600),
  add column late_grace_minutes       integer not null default 15  check (late_grace_minutes between 0 and 240),
  add column arrive_radius_m          integer not null default 200 check (arrive_radius_m between 50 and 2000),
  add column position_max_age_seconds integer not null default 120 check (position_max_age_seconds between 30 and 900),
  add column location_stale_minutes   integer not null default 5   check (location_stale_minutes between 1 and 60),
  add column route_retention_days     integer not null default 30  check (route_retention_days between 1 and 365),
  add column marks_window_days        integer not null default 30  check (marks_window_days between 1 and 365),
  add column marks_rank_lower         integer not null default 2   check (marks_rank_lower between 1 and 20),
  add column marks_pause              integer not null default 3   check (marks_pause between 1 and 20),
  add column marks_pause_days         integer not null default 3   check (marks_pause_days between 1 and 60),
  add column marks_review             integer not null default 4   check (marks_review between 1 and 30);

-- ---------------------------------------------------------------------------------------------
-- Marks and the ladder
create table public.helper_marks (
  id           uuid primary key default gen_random_uuid(),
  helper_id    uuid not null references public.profiles (id) on delete cascade,
  deal_id      uuid not null references public.deals (id) on delete cascade,
  kind         text not null check (kind in ('late', 'no_show')),
  created_at   timestamptz not null default now(),
  appeal_note  text check (appeal_note is null or length(appeal_note) <= 500),
  appealed_at  timestamptz,
  voided_at    timestamptz,
  voided_by    uuid references public.profiles (id),
  unique (deal_id, helper_id)
);
create index helper_marks_helper_idx on public.helper_marks (helper_id, created_at desc);
alter table public.helper_marks enable row level security;
revoke all on public.helper_marks from public, anon, authenticated;
grant select, insert, update on public.helper_marks to service_role;

-- How many marks count now (not voided, inside the window).
create function public.active_marks(p_helper uuid) returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.helper_marks m, public.platform_rules r
  where r.id and m.helper_id = p_helper and m.voided_at is null
    and m.created_at > now() - make_interval(days => r.marks_window_days);
$$;
revoke all on function public.active_marks(uuid) from public, anon, authenticated;
grant execute on function public.active_marks(uuid) to service_role;

create function private.apply_mark_ladder(p_helper uuid) returns void language plpgsql set search_path = '' as $$
declare
  r public.platform_rules;
  n integer;
begin
  select * into r from public.platform_rules where id;
  n := public.active_marks(p_helper);
  if n >= r.marks_review then
    -- paused until Ops looks at the record (Ops lifts it at /ops/marks)
    update public.profiles set suspended_until = now() + interval '100 years' where id = p_helper;
  elsif n >= r.marks_pause then
    update public.profiles
      set suspended_until = greatest(coalesce(suspended_until, now()), now() + make_interval(days => r.marks_pause_days))
      where id = p_helper;
  end if;
end;
$$;

-- Engine events → marks. `helper_late` first; a later `helper_no_show` on the same job upgrades it
-- (still one mark per job).
create function private.mark_from_event() returns trigger language plpgsql set search_path = '' as $$
declare
  v_helper uuid := nullif(new.data ->> 'helperId', '')::uuid;
  v_kind text := case new.code when 'helper_no_show' then 'no_show' else 'late' end;
begin
  if v_helper is null then return new; end if;
  insert into public.helper_marks (helper_id, deal_id, kind)
  values (v_helper, new.deal_id, v_kind)
  on conflict (deal_id, helper_id) do update set kind = 'no_show' where excluded.kind = 'no_show';
  perform private.apply_mark_ladder(v_helper);
  return new;
end;
$$;
create trigger mark_from_event after insert on public.timeline_events for each row
  when (new.code in ('helper_late', 'helper_no_show'))
  execute function private.mark_from_event();

-- ---------------------------------------------------------------------------------------------
-- Location during a job: required, with a route kept for disputes
alter table public.job_locations add column nudged_at timestamptz;

create table public.job_location_points (
  id          bigint generated always as identity primary key,
  deal_id     uuid not null references public.deals (id) on delete cascade,
  helper_id   uuid not null references public.profiles (id) on delete cascade,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  recorded_at timestamptz not null default now()
);
create index job_location_points_deal_idx on public.job_location_points (deal_id, recorded_at);
create index job_location_points_age_idx on public.job_location_points (recorded_at);
alter table public.job_location_points enable row level security;
revoke all on public.job_location_points from public, anon, authenticated;
grant select, insert, delete on public.job_location_points to service_role;

-- Starting the job turns sharing on (no opt-in needed any more).
create function private.start_job_location() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.job_locations (deal_id, helper_id) values (new.id, new.helper_id)
  on conflict (deal_id) do update set helper_id = excluded.helper_id;
  return new;
end;
$$;
create trigger start_job_location after update on public.deals for each row
  when (new.status = 'in_progress' and old.status is distinct from 'in_progress' and new.helper_id is not null and new.type = 'errand')
  execute function private.start_job_location();

-- Jobs already running when this ships: share from now on.
insert into public.job_locations (deal_id, helper_id)
select id, helper_id from public.deals where type = 'errand' and status = 'in_progress' and helper_id is not null
on conflict (deal_id) do nothing;

-- The helper can't switch sharing off while the job runs; switching on stays possible.
create or replace function public.set_job_location_sharing(p_deal uuid, p_helper uuid, p_enabled boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  perform 1 from public.deals where id = p_deal and helper_id = p_helper and status = 'in_progress' for update;
  if not found then return false; end if;
  if not p_enabled then return false; end if;
  insert into public.job_locations(deal_id, helper_id) values (p_deal, p_helper) on conflict do nothing;
  return true;
end;
$$;

-- One sample from the helper's phone: the live position for each running job, plus a route point
-- (at most one per 20 s per job). Only jobs that are in progress and theirs.
create function public.record_job_position(p_helper uuid, p_lat double precision, p_lng double precision)
returns integer language plpgsql set search_path = '' as $$
declare
  n integer := 0;
  j record;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid position' using errcode = '22023';
  end if;
  for j in
    select l.deal_id from public.job_locations l
    join public.deals d on d.id = l.deal_id and d.helper_id = p_helper and d.status = 'in_progress'
    where l.helper_id = p_helper
  loop
    update public.job_locations set lat = p_lat, lng = p_lng, updated_at = now(), nudged_at = null where deal_id = j.deal_id;
    if not exists (select 1 from public.job_location_points p
                   where p.deal_id = j.deal_id and p.recorded_at > now() - interval '20 seconds') then
      insert into public.job_location_points (deal_id, helper_id, lat, lng) values (j.deal_id, p_helper, p_lat, p_lng);
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.record_job_position(uuid, double precision, double precision) from public, anon, authenticated;
grant execute on function public.record_job_position(uuid, double precision, double precision) to service_role;

create function public.purge_job_routes() returns integer language plpgsql set search_path = '' as $$
declare
  n integer;
begin
  delete from public.job_location_points p using public.platform_rules r
  where r.id and p.recorded_at < now() - make_interval(days => r.route_retention_days);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.purge_job_routes() from public, anon, authenticated;
grant execute on function public.purge_job_routes() to service_role;
