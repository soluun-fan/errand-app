-- Rules added by UI-FLOWS.md (see CLAUDE.md §3, §12):
--   * optional pickup address
--   * unpaid errands expire after 30 minutes (awaiting_payment → expired, no money moved)
--   * customers rate the helper after release; helper stats stay in sync

alter table public.deals
  add column pickup_address text,
  add column pay_by timestamptz;

alter table public.ratings
  add column note text check (note is null or length(note) <= 500);

create index deals_pay_due_idx on public.deals (pay_by) where status = 'awaiting_payment';

-- Same as before plus ('errand', 'awaiting_payment', 'expired').
create or replace function public.deal_status_allowed(t public.deal_type, s_from public.deal_status, s_to public.deal_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s_from = s_to or (t, s_from, s_to) in (
    ('errand', 'awaiting_payment', 'open'),
    ('errand', 'awaiting_payment', 'cancelled'),
    ('errand', 'awaiting_payment', 'expired'),
    ('errand', 'open',             'matched'),
    ('errand', 'open',             'cancelled'),
    ('errand', 'open',             'expired'),
    ('errand', 'matched',          'in_progress'),
    ('errand', 'matched',          'cancelled'),
    ('errand', 'in_progress',      'check'),
    ('errand', 'in_progress',      'cancelled'),
    ('errand', 'check',            'released'),
    ('errand', 'check',            'disputed'),
    ('errand', 'disputed',         'released'),
    ('errand', 'disputed',         'refunded'),
    ('goods',  'awaiting_payment', 'held'),
    ('goods',  'awaiting_payment', 'cancelled'),
    ('goods',  'held',             'check'),
    ('goods',  'held',             'cancelled'),
    ('goods',  'check',            'released'),
    ('goods',  'check',            'disputed'),
    ('goods',  'disputed',         'released'),
    ('goods',  'disputed',         'refunded')
  )::boolean;
$$;

-- Count a completed job for the helper exactly when an errand is released.
create function public.deals_count_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type = 'errand' and new.status = 'released' and old.status <> 'released' and new.helper_id is not null then
    update public.profiles set completed_count = completed_count + 1 where id = new.helper_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.deals_count_completed() from public, anon, authenticated;

create trigger deals_count_completed
  after update of status on public.deals
  for each row execute function public.deals_count_completed();

-- Customer rates the helper once, after release. Server-only (service role).
create function public.rate_deal(p_deal_id uuid, p_from uuid, p_stars smallint, p_tags text[] default '{}', p_note text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  d public.deals;
begin
  select * into d from public.deals where id = p_deal_id for update;
  if not found or d.type <> 'errand' or d.status <> 'released' or d.customer_id <> p_from or d.helper_id is null then
    raise exception 'this deal cannot be rated by this user' using errcode = 'PT409';
  end if;
  insert into public.ratings (deal_id, from_user_id, to_user_id, stars, tags, note)
  values (p_deal_id, p_from, d.helper_id, p_stars, coalesce(p_tags, '{}'), nullif(trim(p_note), ''));
  update public.profiles
     set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1
   where id = d.helper_id;
  insert into public.timeline_events (deal_id, code, data)
  values (p_deal_id, 'rated', jsonb_build_object('stars', p_stars));
end;
$$;

revoke execute on function public.rate_deal(uuid, uuid, smallint, text[], text) from public, anon, authenticated;
grant execute on function public.rate_deal(uuid, uuid, smallint, text[], text) to service_role;
