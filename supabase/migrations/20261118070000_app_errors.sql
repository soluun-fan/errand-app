-- Error alerts without an outside service (owner, 2026-11-18: "fix those" — no error monitoring was
-- the launch risk "you'd only hear about failures from complaints"). Server errors (Next.js
-- onRequestError) and errors in people's browsers are grouped by a fingerprint here; Ops gets a push
-- the first time and at most once an hour after, and sees the list at /ops/errors.

create table public.app_errors (
  fingerprint  text primary key check (fingerprint ~ '^[0-9a-f]{16,64}$'),
  source       text not null check (source in ('server', 'client')),
  route        text not null check (length(route) <= 200),
  message      text not null check (length(message) <= 500),
  stack        text check (stack is null or length(stack) <= 4000),
  count        integer not null default 1 check (count > 0),
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  alerted_at   timestamptz,
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles (id)
);
create index app_errors_open_idx on public.app_errors (last_at desc) where resolved_at is null;
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;

-- Record one occurrence. Returns true when Ops should be alerted now (new, came back after being
-- marked fixed, or the last alert was over an hour ago). A flood of new kinds is capped.
create function public.record_app_error(p_fingerprint text, p_source text, p_route text, p_message text, p_stack text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  e public.app_errors;
begin
  select * into e from public.app_errors where fingerprint = p_fingerprint for update;
  if not found then
    -- at most 200 new kinds an hour (a broken page or a spammer can't fill the table)
    if (select count(*) from public.app_errors where first_at > now() - interval '1 hour') >= 200 then
      return false;
    end if;
    insert into public.app_errors (fingerprint, source, route, message, stack, alerted_at)
    values (p_fingerprint, p_source, left(p_route, 200), left(p_message, 500), left(p_stack, 4000), now());
    return true;
  end if;
  update public.app_errors
     set count = count + 1,
         last_at = now(),
         stack = coalesce(left(p_stack, 4000), stack),
         resolved_at = null,
         resolved_by = null,
         alerted_at = case when e.resolved_at is not null or e.alerted_at is null or e.alerted_at < now() - interval '1 hour' then now() else e.alerted_at end
   where fingerprint = p_fingerprint;
  return e.resolved_at is not null or e.alerted_at is null or e.alerted_at < now() - interval '1 hour';
end;
$$;
revoke execute on function public.record_app_error(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_app_error(text, text, text, text, text) to service_role;
