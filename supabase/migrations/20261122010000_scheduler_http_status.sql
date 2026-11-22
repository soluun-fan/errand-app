-- Scheduler diagnostics (2026-11-22). pg_cron reports "succeeded" as soon as pg_net *queues* the
-- tick request, so a rejected call (e.g. 401: the Vault secret no longer matches CRON_SECRET on the
-- host) looked healthy in cron.job_run_details while no tick ran for a week. Also report the HTTP
-- results pg_net kept (about 6 hours), so `npm run check:live` can name the cause. Read-only.
create or replace function public.scheduler_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  http jsonb := '[]';
begin
  if to_regclass('net._http_response') is not null then
    execute $q$
      select coalesce(jsonb_agg(r), '[]') from (
        select status_code, timed_out, left(error_msg, 200) as error, created
        from net._http_response order by created desc limit 5) r
    $q$ into http;
  end if;
  select jsonb_build_object(
    'tick_url', (select value from private.app_config where key = 'tick_url'),
    'secret_set', exists (select 1 from vault.secrets where name = 'cron_secret'),
    'job', (select jsonb_build_object('schedule', schedule, 'active', active) from cron.job where jobname = 'tuslamj-tick'),
    'recent_runs', (select coalesce(jsonb_agg(r), '[]') from (
        select status, start_time from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid where j.jobname = 'tuslamj-tick'
        order by start_time desc limit 5) r),
    'recent_http', http,
    'heartbeat', (select to_jsonb(h) from public.system_heartbeats h where name = 'tick')
  ) into v;
  return v;
end;
$$;
revoke execute on function public.scheduler_status() from public, anon, authenticated;
grant execute on function public.scheduler_status() to service_role;
