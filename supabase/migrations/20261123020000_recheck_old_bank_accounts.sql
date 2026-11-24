-- Code review 2026-11-23: bank accounts marked verified under the old rule (a typed holder name
-- matching the ID, or ID approval) have no bank ownership evidence. Since 64b5817 every account
-- needs an independent bank check, so send those back to the Ops queue (Ops → Withdrawals).
-- Accounts checked under the new rule (an audited bank check after the account's last change) stay.
-- Withdrawals already requested are not touched; new ones wait until Ops records the bank check.
update public.payout_accounts a
set verified_at = null
where a.verified_at is not null
  and not exists (
    select 1 from public.ops_audit_log l
    where l.target = a.user_id::text
      and l.action in ('payout.bank_check_recorded', 'payout.checked')
      and l.created_at >= a.updated_at
  );
