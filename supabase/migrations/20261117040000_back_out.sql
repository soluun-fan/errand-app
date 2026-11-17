-- Backing out (owner, 2026-11-17: "penalty for commission rejection after accepting -- after 10min
-- or so. and immediately the commission post is posted like anew again and notified"):
--
--   * deals.assigned_at: when the current helper was chosen. The engine lets them back out freely
--     for 10 minutes after that; later it is a penalty.
--   * Backing out no longer cancels the task: everything held is refunded and the task is OPEN again
--     (matched → open, in_progress → open), with a fresh search window; the app notifies helpers anew.
--   * helper_penalties: one row per late back-out. The pause escalates over 30 days:
--     1st = 1 day, 2nd = 3 days, 3rd or more = 7 days (and Ops is alerted by the app).
--     apply_transition v7 decides the length here, so no caller can soften it.

alter table public.deals add column assigned_at timestamptz;
-- helpers already chosen before this change: start their 10 minutes now
update public.deals set assigned_at = now()
where type = 'errand' and helper_id is not null and status in ('awaiting_payment', 'matched', 'in_progress');

create table public.helper_penalties (
  id          uuid primary key default gen_random_uuid(),
  helper_id   uuid not null references public.profiles (id) on delete cascade,
  deal_id     uuid not null references public.deals (id) on delete cascade,
  pause_days  integer not null check (pause_days in (1, 3, 7)),
  nth_in_30d  integer not null check (nth_in_30d >= 1),
  created_at  timestamptz not null default now()
);
create index helper_penalties_helper_idx on public.helper_penalties (helper_id, created_at desc);
alter table public.helper_penalties enable row level security;
revoke all on public.helper_penalties from anon, authenticated;

create or replace function public.deal_status_allowed(t public.deal_type, s_from public.deal_status, s_to public.deal_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s_from = s_to or (t, s_from, s_to) in (
    ('errand', 'open',             'awaiting_payment'),
    ('errand', 'open',             'cancelled'),
    ('errand', 'open',             'expired'),
    ('errand', 'awaiting_payment', 'matched'),
    ('errand', 'awaiting_payment', 'open'),
    ('errand', 'awaiting_payment', 'cancelled'),
    ('errand', 'awaiting_payment', 'expired'),
    ('errand', 'open',             'matched'),   -- legacy deals paid at posting
    ('errand', 'matched',          'in_progress'),
    ('errand', 'matched',          'open'),      -- the helper backed out: refunded, posted anew
    ('errand', 'matched',          'cancelled'),
    ('errand', 'in_progress',      'check'),
    ('errand', 'in_progress',      'open'),      -- the helper backed out mid-job
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

-- a paid job's recipient still can't be swapped — except back to nobody once everything was refunded
create or replace function private.assignment_qualified()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- the one exception: the helper backed out — all refunded, nobody assigned, the task open again
  if old.type = 'errand' and old.held_amount > 0 and
     (new.helper_id is distinct from old.helper_id or new.payee_org_id is distinct from old.payee_org_id)
     and not (new.status = 'open' and new.held_amount = 0 and new.helper_id is null and new.payee_org_id is null) then
    raise exception 'cannot change the recipient of a paid job' using errcode = '23514';
  end if;
  if new.type = 'errand' and new.helper_id is not null
     and (new.helper_id is distinct from old.helper_id or new.payee_org_id is distinct from old.payee_org_id)
     and (new.payee_org_id is not null or coalesce((select trust from public.category_settings where category = new.category), 'open') <> 'open')
     and not private.can_take_via(new.helper_id, new.category, new.payee_org_id) then
    raise exception 'helper is not qualified for this kind of task' using errcode = '23514';
  end if;
  return new;
end;
$$;


-- apply_transition v7 = v6 + assigned_at + escalating back-out pauses (p_suspend: [{user_id, at}])
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
    v_days := case when v_n <= 1 then 1 when v_n = 2 then 3 else 7 end;
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

