create table public.recipient_verifications (
  deal_id             uuid primary key references public.deals (id) on delete cascade,
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  phone               text not null,
  share_token_hash    text not null unique check (share_token_hash ~ '^[0-9a-f]{64}$'),
  status              text not null default 'NOT_STARTED'
                      check (status in ('NOT_STARTED', 'CREATING', 'PENDING', 'VERIFIED', 'EXPIRED')),
  session_attempts    smallint not null default 0 check (session_attempts between 0 and 3),
  provider_session_id text unique,
  sms_uri             text,
  display_instruction text,
  session_expires_at  timestamptz,
  verified_at         timestamptz,
  invite_expires_at   timestamptz not null default (now() + interval '24 hours'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint recipient_verification_session_fields check (
    (status = 'NOT_STARTED' and provider_session_id is null and sms_uri is null
      and display_instruction is null and session_expires_at is null and verified_at is null)
    or (status = 'CREATING' and provider_session_id is null and sms_uri is null
      and display_instruction is null and session_expires_at is null and verified_at is null)
    or (status = 'PENDING' and provider_session_id is not null and sms_uri is not null
      and display_instruction is not null and session_expires_at is not null and verified_at is null)
    or (status = 'VERIFIED' and provider_session_id is not null and verified_at is not null)
    or status = 'EXPIRED'
  )
);

alter table public.recipient_verifications enable row level security;
revoke all on public.recipient_verifications from anon, authenticated;
