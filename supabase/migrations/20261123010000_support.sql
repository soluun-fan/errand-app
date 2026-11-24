-- Help & contact (2026-11-23): how people reach a human. Ops fills in the channels at /ops/support
-- (any may be empty); "Message our team" lands in an Ops inbox. Ops answers by phone (Ops can see
-- numbers) and marks it done. Server-only tables.
create table public.support_settings (
  id          boolean primary key default true check (id),
  phone       text check (phone is null or length(phone) <= 40),
  email       text check (email is null or length(email) <= 120),
  facebook    text check (facebook is null or length(facebook) <= 200),
  hours       text check (hours is null or length(hours) <= 120),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id)
);
insert into public.support_settings default values;
alter table public.support_settings enable row level security;
revoke all on public.support_settings from public, anon, authenticated;
grant select, update on public.support_settings to service_role;

create table public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  topic       text not null check (topic in ('payment', 'task', 'helper', 'account', 'other')),
  message     text not null check (length(message) between 10 and 1000),
  status      text not null default 'open' check (status in ('open', 'done')),
  ops_note    text check (ops_note is null or length(ops_note) <= 1000),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  uuid references public.profiles (id)
);
create index support_requests_open_idx on public.support_requests (created_at desc) where status = 'open';
create index support_requests_user_idx on public.support_requests (user_id, created_at desc);
alter table public.support_requests enable row level security;
revoke all on public.support_requests from public, anon, authenticated;
grant select, insert, update on public.support_requests to service_role;
