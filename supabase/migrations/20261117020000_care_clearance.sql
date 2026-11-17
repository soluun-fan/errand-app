-- Care work without an agency (owner, 2026-11-17: "allow the babysitting or the elder caring … that
-- doesn't exactly require certificates or agencies, but need to approve them by additional security
-- and safety, as well as direct communication like mandatory call").
--
--   * Care clearance: an individual helper may be cleared by Ops for childcare / eldercare. It is a
--     `helper_certificates` row for a care kind; only someone who already passed the criminal-record
--     check (kyc_level 4) can ask for one, and Ops approves it after an interview (video call) and
--     references. Agencies (org members) keep working as before.
--   * Talk first: a care task can only be assigned to someone the customer has really talked to on
--     that task — an answered call of at least 30 seconds in their conversation (the server writes
--     the call-log line only for calls it relayed, capped by the time since the answer).
--   * Care kinds stay switched OFF until Ops switches them on (category_settings.live).

-- 1. certificates (clearances) may now be for care kinds too — care needs the background check first
create or replace function private.certificate_kind_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_trust text := (select trust from public.category_settings where category = new.category);
begin
  if v_trust is distinct from 'pro' and v_trust is distinct from 'care' then
    raise exception 'certificates are only for specialized work (pro or care kinds)' using errcode = '23514';
  end if;
  if v_trust = 'care' and tg_op = 'INSERT'
     and coalesce((select kyc_level from public.profiles where id = new.helper_id), 0) < 4 then
    raise exception 'care clearance needs the criminal-record check first' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- 2. on their own: pro work with a certificate, or care work with a clearance AND the background check
create or replace function private.can_take_via(p_helper uuid, p_category public.category, p_org uuid, p_now timestamptz default now())
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_trust text := coalesce((select trust from public.category_settings where category = p_category), 'open');
  v_kyc integer := (select kyc_level from public.profiles where id = p_helper);
begin
  if not exists (select 1 from public.profiles p where p.id = p_helper and p.role = 'helper'
    and p.helper_status = 'approved' and (p.suspended_until is null or p.suspended_until <= p_now)) then
    return false;
  end if;
  if v_trust = 'open' then
    return p_org is null and exists (select 1 from public.profiles p where p.id = p_helper and p_category = any (p.categories));
  end if;
  if p_org is not null then
    return exists (
      select 1 from public.org_members m join public.organizations o on o.id = m.org_id
      where m.org_id = p_org and m.helper_id = p_helper and m.status = 'active' and o.status = 'approved'
        and p_category = any (m.categories) and p_category = any (o.categories)
        and (v_trust <> 'care' or o.kind = 'agency')
    ) and (v_trust <> 'care' or coalesce(v_kyc, 0) >= 4);
  end if;
  -- on their own: an approved, unexpired certificate (pro) or care clearance (care + background check)
  return (v_trust = 'pro' or (v_trust = 'care' and coalesce(v_kyc, 0) >= 4)) and exists (
    select 1 from public.helper_certificates c
    where c.helper_id = p_helper and c.category = p_category and c.status = 'approved'
      and (c.expires_on is null or c.expires_on >= (p_now at time zone 'Asia/Ulaanbaatar')::date)
  );
end;
$$;

-- 3. care: assigned only to someone the customer has really talked to on this task
create function private.care_call_done()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'errand' and new.helper_id is not null and new.helper_id is distinct from old.helper_id
     and coalesce((select trust from public.category_settings where category = new.category), 'open') = 'care'
     and not exists (
       select 1 from public.messages m
       where m.deal_id = new.id and m.helper_id = new.helper_id and m.is_system
         and m.text ~ '^call:ended:(voice|video):[0-9]+$'
         and split_part(m.text, ':', 4)::integer >= 30
     ) then
    raise exception 'care work: talk to the helper on a call first' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger deals_care_call before update on public.deals
  for each row execute function private.care_call_done();
