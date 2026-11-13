-- Send SMS hook (Supabase Auth → Auth Hooks → Send SMS).
--
-- Supabase Auth calls public.send_sms_hook() instead of Twilio/Vonage/etc. for every
-- OTP. For now it does NOT send anything: it records the code in private.sms_outbox,
-- and the login page shows it when DEV_SHOW_SMS_CODES=true (development only).
--
-- Production: replace the body with a call to a Mongolian SMS gateway (e.g. via
-- pg_net or an Edge Function). The rest of the app does not change.

create table private.sms_outbox (
  id          bigint generated always as identity primary key,
  phone       text not null,          -- as Supabase Auth stores it: digits, no "+"
  otp         text not null,
  created_at  timestamptz not null default now()
);
create index sms_outbox_phone_idx on private.sms_outbox (phone, id desc);

revoke all on private.sms_outbox from public, anon, authenticated;

-- Called by Supabase Auth (role supabase_auth_admin). Payload:
--   { "user": { "phone": "97688000001", ... }, "sms": { "otp": "123456" } }
-- Return {} on success, or { "error": { "http_code": ..., "message": ... } }.
create function public.send_sms_hook(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_phone text := event #>> '{user,phone}';
  v_otp   text := event #>> '{sms,otp}';
begin
  if v_phone is null or v_otp is null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'missing phone or otp'));
  end if;

  insert into private.sms_outbox (phone, otp) values (v_phone, v_otp);
  -- keep the outbox small: codes are useless after a few minutes anyway
  delete from private.sms_outbox where created_at < now() - interval '1 hour';

  return '{}'::jsonb;
end;
$$;

revoke execute on function public.send_sms_hook(jsonb) from public, anon, authenticated;
grant execute on function public.send_sms_hook(jsonb) to supabase_auth_admin;
grant usage on schema private to supabase_auth_admin;
grant insert, delete, select on private.sms_outbox to supabase_auth_admin;

-- Server-only read of the latest code for a phone (development helper).
create function public.dev_latest_sms_code(p_phone text)
returns text
language sql
stable
set search_path = ''
as $$
  select otp from private.sms_outbox
  where phone = ltrim(p_phone, '+') and created_at > now() - interval '10 minutes'
  order by id desc
  limit 1;
$$;

revoke execute on function public.dev_latest_sms_code(text) from public, anon, authenticated;
grant execute on function public.dev_latest_sms_code(text) to service_role;
grant select on private.sms_outbox to service_role;
