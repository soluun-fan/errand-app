-- Customer no-show, "On my way", "Need more time?", settle-first window (2026-11-24, owner: decided
-- between customer and helper; "not too discouraging for helpers — Ulaanbaatar traffic").
--
--   * deals.en_route_at: the helper tapped "On my way" — location is shared from then, not only at Start
--   * deals.arrive_extend_minutes: extra minutes the helper asked for (traffic); no late mark within them
--   * deals.absent_at: the helper reported the customer absent; after absent_grace_minutes without an
--     answer the engine cancels and pays the helper the trip fee (+ shopping already done)
--   * platform_rules: settle_hours (unanswered partial-refund offer → Ops), absent_grace_minutes,
--     max_delay_minutes — Ops settings
alter table public.deals
  add column en_route_at timestamptz,
  add column arrive_extend_minutes integer default 0 check (arrive_extend_minutes between 0 and 240), -- null = 0 (SafePay rows)
  add column absent_at timestamptz;
create index deals_absent_idx on public.deals (absent_at) where absent_at is not null;

alter table public.platform_rules
  add column settle_hours          integer not null default 24 check (settle_hours between 1 and 168),
  add column absent_grace_minutes  integer not null default 10 check (absent_grace_minutes between 3 and 60),
  add column max_delay_minutes     integer not null default 30 check (max_delay_minutes between 0 and 120);

-- apply_transition v10 = v9 + en_route_at, arrive_extend_minutes, absent_at
create or replace function public.apply_transition(
  p_deal_id uuid,
  p_expected_version integer,
  p_deal jsonb,
  p_new_offers jsonb default '[]',
  p_removed_offers jsonb default '[]',
  p_dispute jsonb default null,
  p_events jsonb default '[]',
  p_ledger jsonb default '[]',
  p_suspend jsonb default '[]'
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r public.deals := jsonb_populate_record(null::public.deals, p_deal);
  v_version integer;
  v_held bigint;
  v_ledger_hold bigint;
  v_pen record;
  v_n integer;
  v_days integer;
  v_rules public.platform_rules;
begin
  update public.deals d set
    version           = d.version + 1,
    status            = r.status,
    held_amount       = r.held_amount,
    payment_ref       = r.payment_ref,
    check_until       = r.check_until,
    helper_id         = r.helper_id,
    match_by          = r.match_by,
    receipt_amount    = r.receipt_amount,
    item_budget       = r.item_budget,
    fee               = r.fee,
    pay_by            = r.pay_by,
    top_up            = r.top_up,
    handover_proof_at = r.handover_proof_at,
    buyer_id          = r.buyer_id,
    handed_over_at    = r.handed_over_at,
    posted_fee        = r.posted_fee,
    price_change      = r.price_change,
    invite_until      = case when d.invited_helper_id is null then null else r.invite_until end,
    invite_open_after = coalesce(r.invite_open_after, d.invite_open_after),
    provider_refs     = coalesce(r.provider_refs, d.provider_refs),
    payee_org_id      = r.payee_org_id,
    assigned_at       = r.assigned_at,
    en_route_at       = r.en_route_at,
    arrive_extend_minutes = coalesce(r.arrive_extend_minutes, 0),
    absent_at         = r.absent_at
  where d.id = p_deal_id and d.version = p_expected_version
  returning d.version, d.held_amount into v_version, v_held;

  if not found then
    raise exception 'deal % changed since version % (or does not exist)', p_deal_id, p_expected_version
      using errcode = 'PT409';
  end if;

  delete from public.offers o
  where o.deal_id = p_deal_id
    and o.helper_id in (select x::uuid from jsonb_array_elements_text(p_removed_offers) as x);

  insert into public.offers (deal_id, helper_id, org_id, note, price, proposed_by, created_at)
  select p_deal_id, o.helper_id, o.org_id, coalesce(o.note, ''), o.price, coalesce(o.proposed_by, 'helper'), coalesce(o.created_at, now())
  from jsonb_to_recordset(p_new_offers) as o(helper_id uuid, org_id uuid, note text, price bigint, proposed_by text, created_at timestamptz);

  if p_dispute is not null and jsonb_typeof(p_dispute) = 'object' then
    insert into public.disputes (deal_id, opened_by, reason, note, outcome, decided_by, decided_at, created_at)
    select p_deal_id, x.opened_by, x.reason, coalesce(x.note, ''), x.outcome, x.decided_by, x.decided_at, coalesce(x.created_at, now())
    from jsonb_to_record(p_dispute) as x(
      opened_by uuid, reason text, note text, outcome public.dispute_outcome,
      decided_by uuid, decided_at timestamptz, created_at timestamptz
    )
    on conflict (deal_id) do update set
      outcome = excluded.outcome, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  end if;

  insert into public.timeline_events (deal_id, code, data, created_at)
  select p_deal_id, e.code, coalesce(e.data, '{}'::jsonb), coalesce(e.created_at, now())
  from jsonb_to_recordset(p_events) as e(code text, data jsonb, created_at timestamptz);

  insert into public.ledger_entries (deal_id, kind, amount, from_account, to_account, provider_ref, created_at)
  select p_deal_id, l.kind, l.amount, l.from_account, l.to_account, l.provider_ref, coalesce(l.created_at, now())
  from jsonb_to_recordset(p_ledger) as l(
    kind public.ledger_kind, amount bigint, from_account text, to_account text, provider_ref text, created_at timestamptz
  );

  -- a chosen helper backed out late: escalating pause over 30 days (1st 1 day, 2nd 3, then 7)
  for v_pen in
    select s.user_id, coalesce(s.at, now()) as at from jsonb_to_recordset(p_suspend) as s(user_id uuid, at timestamptz)
  loop
    select count(*) + 1 into v_n from public.helper_penalties h
    where h.helper_id = v_pen.user_id and h.created_at > v_pen.at - interval '30 days';
    -- pause lengths are Ops settings (platform_rules); care work (children, elders) is serious from the first time
    select * into v_rules from public.platform_rules where id;
    v_days := case
      when coalesce((select cs.trust from public.category_settings cs join public.deals dd on dd.category = cs.category where dd.id = p_deal_id), 'open') = 'care' then coalesce(v_rules.care_pause_days, 7)
      when v_n <= 1 then coalesce(v_rules.pause_days_first, 1)
      when v_n = 2 then coalesce(v_rules.pause_days_second, 3)
      else coalesce(v_rules.pause_days_more, 7) end;
    insert into public.helper_penalties (helper_id, deal_id, pause_days, nth_in_30d, created_at)
    values (v_pen.user_id, p_deal_id, v_days, v_n, v_pen.at);
    update public.profiles p set suspended_until = greatest(p.suspended_until, v_pen.at + make_interval(days => v_days))
    where p.id = v_pen.user_id;
  end loop;

  v_ledger_hold := public.account_balance('hold', p_deal_id);
  if v_ledger_hold <> v_held then
    raise exception 'ledger hold % does not match held_amount % for deal %', v_ledger_hold, v_held, p_deal_id;
  end if;

  return v_version;
end;
$$;
revoke execute on function public.apply_transition(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.apply_transition(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- Location sharing now also runs from "On my way" (matched) until the job ends.
drop trigger start_job_location on public.deals;
create trigger start_job_location after update on public.deals for each row
  when (new.type = 'errand' and new.helper_id is not null and (
    (new.status = 'in_progress' and old.status is distinct from 'in_progress')
    or (new.status = 'matched' and new.en_route_at is not null and old.en_route_at is null)))
  execute function private.start_job_location();

drop trigger stop_job_location on public.deals;
create trigger stop_job_location after update on public.deals for each row
  when (old.status in ('matched', 'in_progress')
    and (new.status not in ('matched', 'in_progress') or new.helper_id is distinct from old.helper_id))
  execute function private.stop_job_location();

create or replace function public.set_job_location_sharing(p_deal uuid, p_helper uuid, p_enabled boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  perform 1 from public.deals where id = p_deal and helper_id = p_helper
    and (status = 'in_progress' or (status = 'matched' and en_route_at is not null)) for update;
  if not found then return false; end if;
  if not p_enabled then return false; end if;
  insert into public.job_locations(deal_id, helper_id) values (p_deal, p_helper) on conflict do nothing;
  return true;
end;
$$;

create or replace function public.record_job_position(p_helper uuid, p_lat double precision, p_lng double precision)
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
    join public.deals d on d.id = l.deal_id and d.helper_id = p_helper
      and (d.status = 'in_progress' or (d.status = 'matched' and d.en_route_at is not null))
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
