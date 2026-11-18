-- Rules from the database (owner, 2026-11-18: "less hardcode and more backend and database"):
-- the timings and limits Ops may want to tune without a new release. Money math, task states and
-- access rules stay in code (and are double-checked by the database) — only the knobs move here.
-- Each task copies the timings it needs when it's posted (details.rules), so a change never moves
-- a task that is already running. Edited at /ops/rules; every change is logged.

create table public.platform_rules (
  id                          boolean primary key default true check (id),
  payment_window_minutes      integer not null default 10  check (payment_window_minutes between 3 and 60),
  back_out_grace_minutes      integer not null default 10  check (back_out_grace_minutes between 0 and 60),
  now_match_window_minutes    integer not null default 30  check (now_match_window_minutes between 10 and 240),
  schedule_match_window_hours integer not null default 24  check (schedule_match_window_hours between 1 and 168),
  application_minutes         integer not null default 15  check (application_minutes between 5 and 240),
  auto_pick_minutes           integer not null default 3   check (auto_pick_minutes between 1 and 60),
  invite_minutes              integer not null default 15  check (invite_minutes between 5 and 120),
  invite_minutes_scheduled    integer not null default 180 check (invite_minutes_scheduled between 15 and 1440),
  max_applicants              integer not null default 5   check (max_applicants between 1 and 20),
  check_hours                 integer not null default 24  check (check_hours between 2 and 168),
  pause_days_first            integer not null default 1   check (pause_days_first between 0 and 30),
  pause_days_second           integer not null default 3   check (pause_days_second between 0 and 60),
  pause_days_more             integer not null default 7   check (pause_days_more between 0 and 90),
  care_pause_days             integer not null default 7   check (care_pause_days between 0 and 90),
  care_day_start_hour         integer not null default 8   check (care_day_start_hour between 0 and 23),
  care_day_end_hour           integer not null default 21  check (care_day_end_hour between 1 and 24),
  care_max_minutes            integer not null default 360 check (care_max_minutes between 60 and 720 and care_max_minutes % 30 = 0),
  care_call_min_seconds       integer not null default 30  check (care_call_min_seconds between 10 and 600),
  -- helper notifications: each wave reaches further (km), at most `max` people, then waits `seconds`
  dispatch_waves              jsonb not null default '[{"radiusKm":2,"max":5,"seconds":45},{"radiusKm":5,"max":10,"seconds":45},{"radiusKm":10,"max":25,"seconds":60},{"radiusKm":1000,"max":100,"seconds":0}]'
                              check (jsonb_typeof(dispatch_waves) = 'array' and jsonb_array_length(dispatch_waves) between 1 and 8),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.profiles (id),
  constraint platform_rules_care_window check (care_day_start_hour < care_day_end_hour),
  constraint platform_rules_pauses_grow check (pause_days_first <= pause_days_second and pause_days_second <= pause_days_more)
);
insert into public.platform_rules default values;
alter table public.platform_rules enable row level security;
revoke all on public.platform_rules from anon, authenticated;

-- the cancellation fee is a price: it joins the other prices
alter table public.pricing_settings
  add column cancel_fee integer not null default 3000 check (cancel_fee between 0 and 100000);

-- back-out pauses may now be any length Ops sets (0 = record only, no pause)
alter table public.helper_penalties drop constraint helper_penalties_pause_days_check;
alter table public.helper_penalties add constraint helper_penalties_pause_days_check check (pause_days between 0 and 90);

-- care: the required call length comes from the rules too
create or replace function private.care_call_done()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_min integer := coalesce((select care_call_min_seconds from public.platform_rules where id), 30);
begin
  if new.type = 'errand' and new.helper_id is not null and new.helper_id is distinct from old.helper_id
     and coalesce((select trust from public.category_settings where category = new.category), 'open') = 'care'
     and not exists (
       select 1 from public.messages m
       where m.deal_id = new.id and m.helper_id = new.helper_id and m.is_system
         and m.text ~ '^call:ended:(voice|video):[0-9]+$'
         and split_part(m.text, ':', 4)::integer >= v_min
     ) then
    raise exception 'care work: talk to the helper on a call first' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- apply_transition v9 = v8 with the pause lengths read from platform_rules
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
    assigned_at       = r.assigned_at
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
