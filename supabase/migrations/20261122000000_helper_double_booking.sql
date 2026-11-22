-- Double-booking guard (2026-11-22, docs/CONTEXT.md §11 "Cross-deal invariants").
--
-- A helper may be chosen on several tasks at once (each waits for the customer's payment). The
-- first one paid wins: the app then steps the helper back from the others (releaseOtherCommitments).
-- That clean-up runs after the payment commits, so two payments landing together could both book
-- the same helper. This makes the rule atomic in the database:
--
--   * Booking a payment (awaiting_payment → matched) takes a per-helper lock, so two bookings for
--     one helper run one after the other.
--   * The second is refused (PT410) when the helper was booked on another, still-active task after
--     they were chosen here — exactly the tasks the app would have stepped them back from.
--     Work booked *before* they were chosen here (e.g. a scheduled job) is not a conflict.
--     "After" is the database's own event order (timeline ids), not server clocks.
--   * A wire.mn payment refused this way is refunded in full through the existing late-payment
--     path (`refunded_busy`), never left half-booked.

create function private.helper_single_booking() returns trigger language plpgsql set search_path = '' as $$
declare
  chosen_event bigint;
begin
  -- one booking at a time per helper (released at commit/rollback)
  perform pg_advisory_xact_lock(hashtext('helper-booking'), hashtext(new.helper_id::text));
  -- when the helper was (last) chosen on this task; this transition's own events come after the update
  select max(id) into chosen_event from public.timeline_events
   where deal_id = new.id and code in ('accepted', 'chosen');
  if exists (
    select 1
    from public.deals x
    join public.timeline_events e on e.deal_id = x.id and e.code = 'paid'
    where x.helper_id = new.helper_id
      and x.id <> new.id
      and x.type = 'errand'
      and x.status in ('matched', 'in_progress', 'check', 'disputed')
      and e.id > coalesce(chosen_event, 0)
  ) then
    raise exception 'helper already booked on another task' using errcode = 'PT410';
  end if;
  return new;
end;
$$;

create trigger helper_single_booking before update on public.deals for each row
  when (old.status = 'awaiting_payment' and new.status = 'matched' and new.type = 'errand' and new.helper_id is not null)
  execute function private.helper_single_booking();

-- Same as 20261119060000, plus: a booking refused by the guard refunds the payment ('refunded_busy').
create or replace function public.settle_wire_payment(
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
    begin
      perform public.apply_transition(payment.deal_id, p_version, p_transition->'p_deal',
        p_transition->'p_new_offers', p_transition->'p_removed_offers', p_transition->'p_dispute',
        p_transition->'p_events', p_transition->'p_ledger', p_transition->'p_suspend');
      if not exists (select 1 from public.ledger_entries where deal_id = payment.deal_id and kind = 'pay_in'
          and provider_ref = p_intent and amount = p_amount) then
        raise exception 'payment ledger entry missing';
      end if;
      result := 'booked';
    exception when sqlstate 'PT410' then
      -- the helper was booked elsewhere first: nothing of this transition is kept; refund in full
      insert into public.provider_refunds(deal_id,payment_id,amount,reason)
        values (payment.deal_id,p_intent,p_amount,'late payment: helper booked elsewhere');
      result := 'refunded_busy';
    end;
  end if;
  update public.provider_payments set status = case when result in ('refunded','refunded_busy') then 'refunded_late' else 'succeeded' end,
    needs_reconciliation = false, charge_id = coalesce(p_charge,charge_id), succeeded_at = coalesce(succeeded_at,now()), updated_at = now()
    where id = p_intent;
  return result;
end;
$$;
revoke all on function public.settle_wire_payment(text,bigint,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.settle_wire_payment(text,bigint,text,integer,jsonb) to service_role;
