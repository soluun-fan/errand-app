-- Background scheduler (docs/decisions.md 2026-11-15). Supabase's own pg_cron calls the app's
-- /api/cron/tick every 20 s through pg_net — no outside service or account.
--   * the app URL lives in private.app_config; the CRON_SECRET in Supabase Vault (encrypted) —
--     both set at deploy time with `npm run scheduler:configure` (never in git). Until then the
--     job runs but does nothing.
--   * a lease stops overlapping ticks; a heartbeat row records the last success / error.
--   * pg_cron / pg_net / vault exist only on Supabase; the test database skips the scheduling part.

create table private.app_config (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

create table private.leases (
  name   text primary key,
  until  timestamptz not null
);

create table public.system_heartbeats (
  name         text primary key,
  last_run_at  timestamptz not null,
  last_ok_at   timestamptz,
  last_error   text check (last_error is null or length(last_error) <= 1000),
  last_result  jsonb
);
alter table public.system_heartbeats enable row level security;
revoke all on public.system_heartbeats from anon, authenticated;

-- One runner at a time: true if the caller got the lease (it was free or had expired).
create function public.try_lease(p_name text, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.leases (name, until) values (p_name, now() + make_interval(secs => p_seconds))
  on conflict (name) do update set until = excluded.until where private.leases.until <= now();
  return found;
end;
$$;

create function public.release_lease(p_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.leases set until = now() where name = p_name;
$$;

-- What pg_cron runs: GET <tick_url> with the secret from Vault. No-op until configured.
create function private.cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from private.app_config where key = 'tick_url';
  if v_url is null then
    return;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_secret is null then
    return;
  end if;
  perform net.http_get(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 25000
  );
end;
$$;

-- Deploy-time setup (service role only): https URL of /api/cron/tick + the same CRON_SECRET the app has.
create function public.configure_scheduler(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_url !~ '^https://[^\s/]+(/[^\s]*)?/api/cron/tick$' then
    raise exception 'tick URL must be https://<host>/api/cron/tick';
  end if;
  if length(coalesce(p_secret, '')) < 32 then
    raise exception 'secret too short';
  end if;
  insert into private.app_config (key, value) values ('tick_url', p_url)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  select id into v_id from vault.secrets where name = 'cron_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'cron_secret', 'Bearer token for /api/cron/tick');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
end;
$$;

-- For checking it's alive (no secrets): configured URL, job, last runs.
create function public.scheduler_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'tick_url', (select value from private.app_config where key = 'tick_url'),
    'secret_set', exists (select 1 from vault.secrets where name = 'cron_secret'),
    'job', (select jsonb_build_object('schedule', schedule, 'active', active) from cron.job where jobname = 'tuslamj-tick'),
    'recent_runs', (select coalesce(jsonb_agg(r), '[]') from (
        select status, start_time from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid where j.jobname = 'tuslamj-tick'
        order by start_time desc limit 5) r),
    'heartbeat', (select to_jsonb(h) from public.system_heartbeats h where name = 'tick')
  ) into v;
  return v;
end;
$$;

revoke execute on function public.try_lease(text, integer), public.release_lease(text),
  public.configure_scheduler(text, text), public.scheduler_status() from public, anon, authenticated;
grant execute on function public.try_lease(text, integer), public.release_lease(text),
  public.configure_scheduler(text, text), public.scheduler_status() to service_role;
revoke execute on function private.cron_tick() from public;

-- Schedule it (Supabase only). Sub-minute schedules need pg_cron ≥ 1.5; fall back to every minute.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;
    begin
      perform cron.schedule('tuslamj-tick', '20 seconds', 'select private.cron_tick()');
    exception when others then
      perform cron.schedule('tuslamj-tick', '* * * * *', 'select private.cron_tick()');
    end;
  end if;
end $$;
