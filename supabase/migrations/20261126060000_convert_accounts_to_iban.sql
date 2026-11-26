-- 2026-11-26: accounts saved before the IBAN-only rule (20261126040000) can't be updated any more —
-- not even to mark them checked at the first payout. Mongolbank's IBAN wraps the unchanged account
-- number: "MN" + check digits + the bank's 4-digit code + the account number padded to 12 digits.
-- So every old account at a bank with a known code is rewritten as its IBAN (same account, new form).
-- Codes: Mongolbank's payment-system participant list (same table as BANK_CODES in src/lib/kyc-rules.ts).

create or replace function public.mn_iban(p_bank text, p_account text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_code text := case p_bank
    when 'Худалдаа хөгжлийн банк' then '0004'
    when 'Хаан банк' then '0005'
    when 'Голомт банк' then '0015'
    when 'Тээвэр хөгжлийн банк' then '0019'
    when 'Ариг банк' then '0021'
    when 'Үндэсний хөрөнгө оруулалтын банк' then '0029'
    when 'Капитрон банк' then '0030'
    when 'Хас банк' then '0032'
    when 'Төрийн банк' then '0034'
    when 'Богд банк' then '0038'
    when 'М банк' then '0039'
  end;
  v_digits text := regexp_replace(coalesce(p_account, ''), '\D', '', 'g');
  v_bban text;
begin
  if p_account ~ '^MN[0-9]{18}$' then return p_account; end if;
  if v_code is null or length(v_digits) not between 5 and 12 then return null; end if;
  v_bban := v_code || lpad(v_digits, 12, '0');
  return 'MN' || lpad((98 - ((v_bban || '222300')::numeric % 97))::text, 2, '0') || v_bban;
end;
$$;
revoke execute on function public.mn_iban(text, text) from public, anon, authenticated;
grant execute on function public.mn_iban(text, text) to service_role;

update public.payout_accounts
   set account_number = public.mn_iban(bank, account_number)
 where account_number !~ '^MN[0-9]{18}$' and public.mn_iban(bank, account_number) is not null;

update public.organization_payout_accounts
   set account_number = public.mn_iban(bank, account_number)
 where account_number !~ '^MN[0-9]{18}$' and public.mn_iban(bank, account_number) is not null;

-- a withdrawal waiting to be sent keeps pointing at the same account, now written as an IBAN
update public.withdrawals
   set account_number = public.mn_iban(bank, account_number)
 where status = 'requested' and account_number !~ '^MN[0-9]{18}$' and public.mn_iban(bank, account_number) is not null;
