-- Create the code in the posting transaction so a required handover is always possible.
create function private.new_handover_code() returns text language sql volatile set search_path = '' as $$
  select lpad((abs(hashtextextended(gen_random_uuid()::text, 0)::numeric) % 10000)::text, 4, '0');
$$;
create function private.issue_handover_code() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.handover_codes(deal_id, code) values (new.id, private.new_handover_code());
  return new;
end;
$$;
create trigger issue_handover_code after insert on public.deals for each row
  when (new.type = 'errand' and new.details->'require'->>'handoverCode' = 'true')
  execute function private.issue_handover_code();

insert into public.handover_codes(deal_id, code)
select id, private.new_handover_code() from public.deals
where type = 'errand' and status in ('open','awaiting_payment','matched','in_progress')
  and details->'require'->>'handoverCode' = 'true'
on conflict (deal_id) do nothing;

-- Presence for receiving job offers is separate from a helper opting into one customer's map.
create table public.job_locations (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  helper_id uuid not null references public.profiles(id) on delete cascade,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
alter table public.job_locations enable row level security;
revoke all on public.job_locations from public, anon, authenticated;
grant select, insert, update, delete on public.job_locations to service_role;

create function public.set_job_location_sharing(p_deal uuid, p_helper uuid, p_enabled boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  perform 1 from public.deals where id = p_deal and helper_id = p_helper and status = 'in_progress' for update;
  if not found then return false; end if;
  if p_enabled then
    insert into public.job_locations(deal_id, helper_id) values (p_deal, p_helper) on conflict do nothing;
  else
    delete from public.job_locations where deal_id = p_deal and helper_id = p_helper;
  end if;
  return true;
end;
$$;
revoke all on function public.set_job_location_sharing(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_job_location_sharing(uuid,uuid,boolean) to service_role;

create function private.stop_job_location() returns trigger language plpgsql set search_path = '' as $$
begin
  delete from public.job_locations where deal_id = new.id;
  return new;
end;
$$;
create trigger stop_job_location after update on public.deals for each row
  when (old.status = 'in_progress' and (new.status <> old.status or new.helper_id is distinct from old.helper_id))
  execute function private.stop_job_location();

create function private.reset_handover_code() returns trigger language plpgsql set search_path = '' as $$
begin
  update public.handover_codes set code = private.new_handover_code(),
    verified_at = null, failed_attempts = 0, locked_until = null where deal_id = new.id;
  return new;
end;
$$;
create trigger reset_handover_code after update on public.deals for each row
  when (old.helper_id is not null and new.helper_id is distinct from old.helper_id
    and new.details->'require'->>'handoverCode' = 'true')
  execute function private.reset_handover_code();

create function public.check_handover_code(p_deal uuid, p_helper uuid, p_attempt text)
returns text language plpgsql set search_path = '' as $$
declare
  handover public.handover_codes;
begin
  perform 1 from public.deals where id = p_deal and helper_id = p_helper and status = 'in_progress' for update;
  if not found then return 'missing'; end if;
  select * into handover from public.handover_codes where deal_id = p_deal for update;
  if not found then return 'missing'; end if;
  if handover.verified_at is not null then return 'ok'; end if;
  if handover.locked_until > now() then return 'locked'; end if;
  if p_attempt = handover.code then
    update public.handover_codes set verified_at = now(), failed_attempts = 0, locked_until = null where deal_id = p_deal;
    return 'ok';
  end if;
  if handover.failed_attempts >= 4 then
    update public.handover_codes set failed_attempts = 0, locked_until = now() + interval '15 minutes' where deal_id = p_deal;
    return 'locked';
  end if;
  update public.handover_codes set failed_attempts = failed_attempts + 1 where deal_id = p_deal;
  return 'wrong';
end;
$$;
revoke all on function public.check_handover_code(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.check_handover_code(uuid,uuid,text) to service_role;
