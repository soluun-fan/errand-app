-- Older handlers could persist a terminal status before the ledger or refund was committed.
-- Recheck these receipts with Wire instead of guessing how much money arrived.
alter table public.provider_payments add column needs_reconciliation boolean not null default false;
update public.provider_payments p set needs_reconciliation = true
where p.provider = 'wire' and (
  (p.status = 'succeeded' and not exists (select 1 from public.ledger_entries l
      where l.deal_id = p.deal_id and l.kind = 'pay_in' and l.provider_ref = p.id))
  or (p.status = 'refunded_late' and not exists (select 1 from public.provider_refunds r
      where r.payment_id = p.id and r.reason like 'late payment%'))
);
create index wire_receipts_to_reconcile on public.provider_payments (deal_id) where needs_reconciliation;

-- Serialize webhook and return-page reconciliation. The ledger, task and provider result commit together.
create function public.settle_wire_payment(
  p_intent text, p_amount bigint, p_charge text, p_version integer, p_transition jsonb
) returns text language plpgsql set search_path = '' as $$
declare
  payment public.provider_payments;
  actual_version integer;
  result text;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'invalid payment amount'; end if;
  select * into payment from public.provider_payments where id = p_intent and provider = 'wire' for update;
  if not found then return 'unknown'; end if;

  select version into strict actual_version from public.deals where id = payment.deal_id for update;
  if exists (select 1 from public.ledger_entries where deal_id = payment.deal_id and kind = 'pay_in' and provider_ref = p_intent) then
    result := 'already';
  elsif exists (select 1 from public.provider_refunds where payment_id = p_intent and reason like 'late payment%') then
    update public.provider_payments set needs_reconciliation = false, charge_id = coalesce(p_charge,charge_id) where id = p_intent;
    return 'already';
  elsif actual_version <> p_version then
    raise exception 'deal changed during payment' using errcode = 'PT409';
  elsif p_transition is null or payment.status = 'refunded_late' then
    insert into public.provider_refunds(deal_id,payment_id,amount,reason)
      values (payment.deal_id,p_intent,p_amount,'late payment');
    result := 'refunded';
  else
    if payment.amount <> p_amount or p_transition->>'p_deal_id' is distinct from payment.deal_id::text then
      raise exception 'payment transition mismatch';
    end if;
    perform public.apply_transition(payment.deal_id, p_version, p_transition->'p_deal',
      p_transition->'p_new_offers', p_transition->'p_removed_offers', p_transition->'p_dispute',
      p_transition->'p_events', p_transition->'p_ledger', p_transition->'p_suspend');
    if not exists (select 1 from public.ledger_entries where deal_id = payment.deal_id and kind = 'pay_in'
        and provider_ref = p_intent and amount = p_amount) then
      raise exception 'payment ledger entry missing';
    end if;
    result := 'booked';
  end if;
  update public.provider_payments set status = case when result = 'refunded' then 'refunded_late' else 'succeeded' end,
    needs_reconciliation = false, charge_id = coalesce(p_charge,charge_id), succeeded_at = coalesce(succeeded_at,now()), updated_at = now()
    where id = p_intent;
  return result;
end;
$$;
revoke all on function public.settle_wire_payment(text,bigint,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.settle_wire_payment(text,bigint,text,integer,jsonb) to service_role;

-- Concurrent refund sweeps must allocate each returned tugrik only once.
create function public.queue_wire_refunds(p_deal uuid) returns void language plpgsql set search_path = '' as $$
declare
  customer uuid;
  due bigint;
  payment record;
  take bigint;
begin
  select customer_id into strict customer from public.deals where id = p_deal for update;
  select coalesce(sum(amount),0) into due from public.ledger_entries
    where deal_id = p_deal and kind in ('refund','budget_refund') and to_account = 'ext:' || customer;
  due := due - (select coalesce(sum(amount),0) from public.provider_refunds
    where deal_id = p_deal and coalesce(reason,'') not like 'late payment%');
  for payment in select p.id, p.amount - coalesce((select sum(r.amount) from public.provider_refunds r where r.payment_id=p.id),0) as room
    from public.provider_payments p where p.deal_id=p_deal and p.provider='wire' and p.status='succeeded' and not p.needs_reconciliation
    order by p.succeeded_at desc, p.id
  loop
    exit when due <= 0;
    take := least(due,payment.room);
    if take > 0 then
      insert into public.provider_refunds(deal_id,payment_id,amount,reason) values(p_deal,payment.id,take,'task refund');
      due := due - take;
    end if;
  end loop;
end;
$$;
revoke all on function public.queue_wire_refunds(uuid) from public, anon, authenticated;
grant execute on function public.queue_wire_refunds(uuid) to service_role;
