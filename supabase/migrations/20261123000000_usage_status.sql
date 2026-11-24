-- Free-plan watch (2026-11-23, owner: no paid plans until the app succeeds). How much of the
-- Supabase free limits we use: database size (500 MB) and uploaded files (1 GB). Read-only; shown by
-- `npm run check:live` so we upgrade before a limit stops the app.
create function public.usage_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  files bigint := 0;
begin
  if to_regclass('storage.objects') is not null then
    execute $q$ select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects $q$ into files;
  end if;
  return jsonb_build_object('db_bytes', pg_database_size(current_database()), 'file_bytes', files);
end;
$$;
revoke execute on function public.usage_status() from public, anon, authenticated;
grant execute on function public.usage_status() to service_role;
