create table public.verify_mn_sessions (
  id                   uuid primary key default gen_random_uuid(),
  provider_session_id  text not null unique,
  user_id              uuid not null references public.profiles (id) on delete cascade,
  phone                text not null,
  sms_uri              text not null,
  display_instruction  text not null,
  status               text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'EXPIRED')),
  expires_at           timestamptz not null,
  verified_at          timestamptz,
  created_at           timestamptz not null default now()
);

create index verify_mn_sessions_user_phone_idx
  on public.verify_mn_sessions (user_id, phone, created_at desc);

alter table public.verify_mn_sessions enable row level security;
revoke all on public.verify_mn_sessions from anon, authenticated;
