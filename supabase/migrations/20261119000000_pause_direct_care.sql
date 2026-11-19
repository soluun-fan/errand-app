-- Existing bookings keep their original rules. The insert trigger checks this switch for new jobs.
update public.category_settings
set live = false, updated_at = now(), updated_by = null
where trust = 'care' and live;

-- An older open post cannot be matched after care has closed. Assigned jobs can finish.
create trigger deals_care_assignment_live before update of helper_id on public.deals
  for each row when (new.category in ('childcare', 'eldercare')
    and new.helper_id is not null and new.helper_id is distinct from old.helper_id)
  execute function private.deal_category_live();

create function private.care_offer_live() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.deals d join public.category_settings c on c.category = d.category
    where d.id = new.deal_id and c.trust = 'care' and not c.live and d.status = 'open'
  ) then
    raise exception 'this kind of task is not available right now' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger offers_care_live before insert on public.offers
  for each row execute function private.care_offer_live();
