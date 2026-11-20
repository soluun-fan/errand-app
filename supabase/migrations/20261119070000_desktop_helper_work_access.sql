alter table public.profiles
  add column if not exists desktop_work_enabled boolean not null default false;
