-- The IBAN rule checks a number when it is entered or changed, not every later update of the row
-- (2026-11-27 reliability review).
--
-- 20261126040000 added `check (account_number ~ '^MN[0-9]{18}$') not valid`. NOT VALID skips old
-- rows only once: Postgres re-checks the constraint on ANY later update of such a row. An old
-- account the IBAN conversion could not rewrite (an unknown bank, or more than 12 digits) then
-- blocked every update of its row — marking it checked at a payout, clearing the check when Ops
-- reopens a verification or switches a helper off — and those actions failed halfway.
-- A trigger on account_number gives the same rule for new and changed numbers only. Such an old
-- account can still never receive money: a payout needs it checked, and checking needs the
-- holder's name from the bank for that exact number; the helper is asked to enter it again.

alter table public.payout_accounts drop constraint if exists payout_accounts_account_number_check;
alter table public.organization_payout_accounts drop constraint if exists organization_payout_accounts_account_number_check;

create function private.iban_on_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.account_number !~ '^MN[0-9]{18}$' then
    raise exception 'account number must be an IBAN (MN + 18 digits)' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger payout_accounts_iban
  before insert or update of account_number on public.payout_accounts
  for each row execute function private.iban_on_entry();
create trigger organization_payout_accounts_iban
  before insert or update of account_number on public.organization_payout_accounts
  for each row execute function private.iban_on_entry();
