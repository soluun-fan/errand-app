-- Care pilot + trip time (owner, 2026-11-17: "babysitting and stuff...can we?", "wouldnt the price
-- match the duration they go through"):
--
--   * pricing_settings.travel_min_per_km: travel time per km (per leg) that fills in "About how long?"
--     for two-place tasks, so a trip there and back is priced by the time it takes. Ops can edit it.
--   * helper_certificates.first_aid: a care clearance may say a first-aid certificate is among the
--     files; once Ops approves the clearance, families see a first-aid badge.
--   * apply_transition v8 = v7 + a late back-out from care work pauses the helper 7 days at once.
--   (Daytime-only / 6-hour care, check-out without a photo, meet-first and the Ops alert on low care
--   ratings are app and engine rules; care kinds stay switched off until Ops turns them on.)

alter table public.pricing_settings
  add column travel_min_per_km integer not null default 3 check (travel_min_per_km between 0 and 15);

alter table public.helper_certificates
  add column first_aid boolean not null default false;

-- apply_transition v8
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
    -- care work (children, elders): a late back-out is serious from the first time
    v_days := case
      when coalesce((select cs.trust from public.category_settings cs join public.deals dd on dd.category = cs.category where dd.id = p_deal_id), 'open') = 'care' then 7
      when v_n <= 1 then 1 when v_n = 2 then 3 else 7 end;
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
