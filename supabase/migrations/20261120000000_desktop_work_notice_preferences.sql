create table public.desktop_work_notice_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  hidden boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.desktop_work_notice_preferences enable row level security;
revoke all on public.desktop_work_notice_preferences from anon, authenticated;
