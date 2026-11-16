-- Saved helpers (docs/decisions.md 2026-11-16 "Helper profiles"): a customer's ♡ list of helpers
-- to find again. Clients may read only their own rows; saving / removing goes through server
-- code (service role), like every other write.

create table public.saved_helpers (
  customer_id uuid not null references public.profiles (id) on delete cascade,
  helper_id   uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (customer_id, helper_id),
  constraint saved_helpers_not_self check (customer_id <> helper_id)
);
create index saved_helpers_helper on public.saved_helpers (helper_id);

alter table public.saved_helpers enable row level security;
revoke all on public.saved_helpers from anon, authenticated;
grant select on public.saved_helpers to authenticated;
create policy "saved_helpers: own list" on public.saved_helpers
  for select to authenticated using (customer_id = auth.uid());
