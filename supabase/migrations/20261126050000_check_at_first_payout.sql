-- 2026-11-26 (owner: "for convenience sake, do we really not have the option to do easier"; chose
-- "check during first payout"). Ops sends every payout by hand from the bank app, and the bank shows
-- the holder's name before the transfer is confirmed — so the account check happens then, not as a
-- separate step first. A helper may now ASK for a withdrawal with an unchecked account; marking it
-- SENT still needs a checked account, and the very account the request was made for.

create or replace function public.request_withdrawal(p_helper uuid, p_auto boolean default false)
returns public.withdrawals
language plpgsql
set search_path = ''
as $$
declare
  r public.platform_rules;
  acct public.payout_accounts;
  v_amount bigint;
  v_today integer;
  w public.withdrawals;
  v_id uuid := gen_random_uuid();
begin
  perform 1 from public.profiles where id = p_helper for update; -- one request at a time per person
  select * into r from public.platform_rules where id;
  select * into acct from public.payout_accounts where user_id = p_helper;
  if not found then
    raise exception 'no bank account yet' using errcode = '23514';
  end if;
  v_amount := public.account_balance('payable:' || p_helper::text);
  if v_amount <= 0 or (not p_auto and v_amount < r.withdraw_min) then
    raise exception 'below the minimum withdrawal' using errcode = '23514';
  end if;
  if not p_auto then
    select count(*) into v_today from public.withdrawals
     where helper_id = p_helper and not auto
       and (requested_at at time zone 'Asia/Ulaanbaatar')::date = (now() at time zone 'Asia/Ulaanbaatar')::date;
    if v_today >= r.withdrawals_per_day then
      raise exception 'too many withdrawals today' using errcode = '23514';
    end if;
  end if;
  insert into public.withdrawals (id, helper_id, amount, reference, bank, account_number, holder_name, auto)
  values (v_id, p_helper, v_amount, 'PAYOUT-' || upper(substr(replace(v_id::text, '-', ''), 1, 8)), acct.bank, acct.account_number, acct.holder_name, p_auto)
  returning * into w;
  insert into public.ledger_entries (deal_id, kind, amount, from_account, to_account, provider_ref)
  values (null, 'withdrawal', v_amount, 'payable:' || p_helper::text, 'payout:' || p_helper::text, w.reference);
  return w;
end;
$$;

-- Ops sent it from the bank app (or it failed: the amount goes back to what we owe).
-- "Sent" only to a checked account that is still the one this withdrawal was made for.
create or replace function public.decide_withdrawal(p_id uuid, p_ops uuid, p_sent boolean, p_note text default null)
returns public.withdrawals
language plpgsql
set search_path = ''
as $$
declare
  w public.withdrawals;
  acct public.payout_accounts;
begin
  select * into w from public.withdrawals where id = p_id for update;
  if not found or w.status <> 'requested' then
    raise exception 'this withdrawal was already handled' using errcode = 'PT409';
  end if;
  if p_sent then
    select * into acct from public.payout_accounts where user_id = w.helper_id;
    if not found or acct.verified_at is null or acct.account_number <> w.account_number then
      raise exception 'bank account not checked' using errcode = '23514';
    end if;
  end if;
  update public.withdrawals
     set status = case when p_sent then 'sent' else 'failed' end, decided_at = now(), decided_by = p_ops, note = nullif(trim(p_note), '')
   where id = p_id
   returning * into w;
  insert into public.ledger_entries (deal_id, kind, amount, from_account, to_account, provider_ref)
  values (null, 'withdrawal', w.amount, 'payout:' || w.helper_id::text,
          case when p_sent then 'ext:' else 'payable:' end || w.helper_id::text, w.reference);
  return w;
end;
$$;
