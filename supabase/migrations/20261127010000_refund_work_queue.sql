-- Refunds the ledger owes, found by what is owed rather than by payment age (2026-11-27 reliability review).
--
-- Before: the background sweep re-checked every wire payment from the last 30 days, every 20 s.
-- That missed refunds that arise later (a task booked > 30 days ahead and cancelled, a dispute
-- decided late), silently skipped tasks past the API's 1000-row cap, and grew with every payment.
--
-- Now one query returns the tasks with actual refund work:
--   * owing  – the ledger refunded the customer more than we have asked wire to refund, and a wire
--              payment still has room to refund against (same arithmetic as queue_wire_refunds);
--   * retry  – a refund request that is due again: failed (exponential backoff, 1 min doubling up
--              to 6 h, at most 10 tries), never sent, or "pending" at wire with no news for 1 h.
-- Requests that used all 10 tries stay for Ops on /ops/payments.

create index if not exists ledger_refund_deal_idx
  on public.ledger_entries (deal_id)
  where kind in ('refund', 'budget_refund');

create function public.wire_refund_work(p_limit integer default 100)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  with owed as (
    select l.deal_id, sum(l.amount) as refunded
      from public.ledger_entries l
      join public.deals d on d.id = l.deal_id
     where l.kind in ('refund', 'budget_refund')
       and l.to_account = 'ext:' || d.customer_id::text
     group by l.deal_id
  ),
  asked as (
    select deal_id, sum(amount) as asked
      from public.provider_refunds
     where coalesce(reason, '') not like 'late payment%'
     group by deal_id
  ),
  owing as (
    select o.deal_id
      from owed o
      left join asked a on a.deal_id = o.deal_id
     where o.refunded > coalesce(a.asked, 0)
       and exists (
         select 1 from public.provider_payments p
          where p.deal_id = o.deal_id
            and p.provider = 'wire'
            and p.status = 'succeeded'
            and not p.needs_reconciliation
            and p.amount > coalesce((select sum(r.amount) from public.provider_refunds r where r.payment_id = p.id), 0)
       )
  ),
  retry as (
    select r.deal_id
      from public.provider_refunds r
     where r.attempts < 10
       and (
         (r.status = 'failed' and r.updated_at < now() - least(interval '6 hours', interval '1 minute' * power(2, r.attempts)))
         or (r.status = 'pending' and r.provider_ref is null)
         or (r.status = 'pending' and r.provider_ref is not null and r.updated_at < now() - interval '1 hour')
       )
  )
  select deal_id
    from (select deal_id from owing union select deal_id from retry) work
   order by deal_id
   limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.wire_refund_work(integer) from public, anon, authenticated;
grant execute on function public.wire_refund_work(integer) to service_role;
