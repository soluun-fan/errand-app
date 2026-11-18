-- Registration, terms and leaving (owner, 2026-11-18: "make it finished. ins and outs. registration
-- and conditions all carefully set"; V1 spec A5: 18+ only, A7: customer terms + helper agreement).
--
--   * profiles.birth_date: 18 or older, checked here on every write.
--   * profiles.*_version: the version of each document the person last accepted (Terms, Privacy, the
--     Helper service agreement). The app asks again when a version changes. Every acceptance is also
--     kept in legal_acceptances (who, what, which version, when) — the record a lawyer will want.
--   * profiles.deleted_at: the account was closed by its owner; personal details are removed, the
--     transaction history stays (the law requires keeping payment records).

alter table public.profiles
  add column birth_date            date,
  add column terms_version         text check (terms_version is null or terms_version ~ '^\d{4}-\d{2}-\d{2}[a-z]?$'),
  add column privacy_version       text check (privacy_version is null or privacy_version ~ '^\d{4}-\d{2}-\d{2}[a-z]?$'),
  add column helper_terms_version  text check (helper_terms_version is null or helper_terms_version ~ '^\d{4}-\d{2}-\d{2}[a-z]?$'),
  add column deleted_at            timestamptz;

-- 18+ (spec A5): checked against today in Ulaanbaatar whenever the date is set or changed
create function private.profiles_adult()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.birth_date is not null and new.birth_date is distinct from old.birth_date
     and (new.birth_date > ((now() at time zone 'Asia/Ulaanbaatar')::date - interval '18 years')::date
          or new.birth_date < date '1900-01-01') then
    raise exception 'must be 18 or older' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger profiles_adult before update of birth_date on public.profiles
  for each row execute function private.profiles_adult();

create table public.legal_acceptances (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  document     text not null check (document in ('terms', 'privacy', 'helper')),
  version      text not null check (version ~ '^\d{4}-\d{2}-\d{2}[a-z]?$'),
  accepted_at  timestamptz not null default now(),
  primary key (user_id, document, version)
);
alter table public.legal_acceptances enable row level security;
revoke all on public.legal_acceptances from anon, authenticated;
