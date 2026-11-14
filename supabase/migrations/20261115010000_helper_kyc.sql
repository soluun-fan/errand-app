-- Helper verification (docs/decisions.md 2026-11-15):
--   * a helper submits ID front/back, a selfie holding the ID, a criminal-record certificate
--     ("ял шийтгэлгүй тодорхойлолт") and a payout account in the same name; Ops reviews by hand
--   * documents live in a PRIVATE bucket that only server code opens (Ops sees 5-minute links);
--     images are deleted 30 days after the decision — we keep the verified name, the last 4 digits
--     of the ID number and who decided when
--   * applications and full account numbers are SERVER-ONLY: no client grants at all

create table public.helper_applications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'submitted'
                  check (status in ('submitted', 'approved', 'rejected', 'changes_requested')),
  legal_name      text not null check (length(trim(legal_name)) between 3 and 80),
  id_last4        text not null check (id_last4 ~ '^[0-9]{4}$'),
  birth_date      date,                                        -- nulled when files are purged
  categories      public.category[] not null check (cardinality(categories) between 1 and 6),
  id_front_path   text,
  id_back_path    text,
  selfie_path     text,
  record_path     text,
  consent_at      timestamptz not null,
  submitted_at    timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references public.profiles (id),
  decision_note   text check (decision_note is null or length(decision_note) <= 500),
  files_purged_at timestamptz,
  check ((status = 'submitted') = (decided_at is null)),
  check (status = 'submitted' or decided_by is not null)
);
create index helper_applications_user_idx on public.helper_applications (user_id, submitted_at desc);
create index helper_applications_queue_idx on public.helper_applications (submitted_at) where status = 'submitted';
-- at most one application waiting for review per person
create unique index helper_applications_one_open on public.helper_applications (user_id) where status = 'submitted';

create table public.payout_accounts (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  bank            text not null check (length(bank) between 2 and 40),
  account_number  text not null check (account_number ~ '^(MN[0-9]{18}|[0-9]{6,20})$'),
  holder_name     text not null check (length(trim(holder_name)) between 3 and 80),
  verified_at     timestamptz,
  updated_at      timestamptz not null default now()
);

alter table public.helper_applications enable row level security;
alter table public.payout_accounts enable row level security;
-- no policies + no grants: only the service role (server code, after its own checks) can touch these
revoke all on public.helper_applications, public.payout_accounts from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc', 'kyc', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
