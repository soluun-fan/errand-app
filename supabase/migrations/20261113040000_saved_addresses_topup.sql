-- Decisions of 2026-11-13 (docs/decisions.md):
--   * Buy-for-me receipt over budget → the customer approves and pays the difference as a
--     second held payment (deals.top_up), or declines and the helper returns the items.
--   * Saved addresses (Гэр / Ажил / Бусад), saved while posting.

alter table public.deals
  add column top_up jsonb check (top_up is null or jsonb_typeof(top_up) = 'object');

-- Same as before, plus item_budget (grows when a top-up is paid) and top_up.
create or replace function public.apply_transition(
  p_deal_id uuid,
  p_expected_version integer,
  p_deal jsonb,
  p_new_offers jsonb default '[]',
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
    top_up            = r.top_up,
    handover_proof_at = r.handover_proof_at,
    buyer_id          = r.buyer_id,
    handed_over_at    = r.handed_over_at
  where d.id = p_deal_id and d.version = p_expected_version
  returning d.version, d.held_amount into v_version, v_held;

  if not found then
    raise exception 'deal % changed since version % (or does not exist)', p_deal_id, p_expected_version
      using errcode = 'PT409';
  end if;

  insert into public.offers (deal_id, helper_id, note, created_at)
  select p_deal_id, o.helper_id, coalesce(o.note, ''), coalesce(o.created_at, now())
  from jsonb_to_recordset(p_new_offers) as o(helper_id uuid, note text, created_at timestamptz);

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

  update public.profiles p set suspended_until = greatest(p.suspended_until, s.until)
  from jsonb_to_recordset(p_suspend) as s(user_id uuid, until timestamptz)
  where p.id = s.user_id;

  v_ledger_hold := public.account_balance('hold', p_deal_id);
  if v_ledger_hold <> v_held then
    raise exception 'ledger hold % does not match held_amount % for deal %', v_ledger_hold, v_held, p_deal_id;
  end if;

  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Saved addresses
-- ---------------------------------------------------------------------------
create table public.saved_addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('home', 'work', 'other')),
  label       text check (label is null or length(label) between 1 and 30),
  address     text not null check (length(trim(address)) between 1 and 200),
  entrance    text check (entrance is null or length(entrance) <= 20),
  floor       smallint check (floor is null or floor between 0 and 60),
  unit        text check (unit is null or length(unit) <= 20),
  lift        text check (lift is null or lift in ('yes', 'no', 'unknown')),
  note        text check (note is null or length(note) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One Home and one Work per person; any number of others (capped in the app).
create unique index saved_addresses_one_home_work on public.saved_addresses (user_id, kind)
  where kind in ('home', 'work');
create index saved_addresses_user_idx on public.saved_addresses (user_id, created_at);

alter table public.saved_addresses enable row level security;

-- Private to the owner: no one else (not even helpers on a task) reads this table;
-- the task itself carries a copy of the address.
create policy "saved_addresses: own rows" on public.saved_addresses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.saved_addresses to authenticated;
