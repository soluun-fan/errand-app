-- Payout accounts are IBAN only from now on (owner 2026-11-26: "do we include IBAN? any letters?").
-- Mongolian banks moved to IBAN from 1 April 2025: "MN" + 18 digits. The app also checks the IBAN
-- check digits. NOT VALID: older rows keep working until they're next changed; every new or changed
-- account must be an IBAN.
alter table public.payout_accounts drop constraint if exists payout_accounts_account_number_check;
alter table public.payout_accounts
  add constraint payout_accounts_account_number_check check (account_number ~ '^MN[0-9]{18}$') not valid;
alter table public.organization_payout_accounts drop constraint if exists organization_payout_accounts_account_number_check;
alter table public.organization_payout_accounts
  add constraint organization_payout_accounts_account_number_check check (account_number ~ '^MN[0-9]{18}$') not valid;
