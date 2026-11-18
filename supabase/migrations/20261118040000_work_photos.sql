-- Public work photos: helper portfolio + photos in reviews (owner, 2026-11-18: "put it in the
-- worker's portfolio kind of thing. and also just in the homepage"; PleaseHelp's home is full of
-- photos from finished jobs).
--
-- Nothing private goes public without the person who owns the moment agreeing:
--   * review   — the customer adds up to 3 photos when rating a finished job; they know it's public.
--                Shown with the review; in the helper's portfolio only when the review is 4★ or more.
--   * helper   — the helper picks up to 4 of their own handover / progress photos of a finished job;
--                they go public only after that job's customer says yes.
-- Never for care work (children, elders). Ops can hide any photo; 3 reports hide it at once.
--
-- Files: uploads wait in the PRIVATE "task-photos" bucket (review) or are the private proofs
-- (helper); only on "shown" does the server copy a re-checked JPEG into the PUBLIC "work-photos"
-- bucket under a random name. Hiding or removing deletes the public file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-photos', 'work-photos', true, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create table public.work_photos (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.deals (id) on delete cascade,
  helper_id     uuid not null references public.profiles (id) on delete cascade,
  source        text not null check (source in ('review', 'helper')),
  uploaded_by   uuid not null references public.profiles (id) on delete cascade,
  -- helper photos: which proof; review photos: the waiting upload in "task-photos"
  proof_id      uuid unique references public.proofs (id) on delete cascade,
  staging_path  text check (staging_path is null or staging_path ~ '^r/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  -- the public copy in "work-photos", set when shown
  file_path     text unique check (file_path is null or file_path ~ '^[0-9a-f-]{36}\.jpg$'),
  status        text not null check (status in ('uploading', 'asked', 'shown', 'declined', 'removed', 'hidden')),
  in_portfolio  boolean not null default false,
  reports       integer not null default 0 check (reports >= 0),
  decided_at    timestamptz,
  removed_by    uuid references public.profiles (id),
  hide_reason   text check (hide_reason is null or length(hide_reason) <= 300),
  created_at    timestamptz not null default now(),
  constraint work_photos_source check (
    (source = 'helper' and proof_id is not null and staging_path is null and status <> 'uploading')
    or (source = 'review' and proof_id is null and status <> 'asked' and status <> 'declined')
  ),
  constraint work_photos_shown_file check (status <> 'shown' or file_path is not null)
);
create index work_photos_shown_idx on public.work_photos (created_at desc) where status = 'shown';
create index work_photos_helper_idx on public.work_photos (helper_id, created_at desc) where status = 'shown';
create index work_photos_deal_idx on public.work_photos (deal_id);
create index work_photos_loose_idx on public.work_photos (created_at) where status = 'uploading';

create table public.work_photo_reports (
  photo_id     uuid not null references public.work_photos (id) on delete cascade,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  reason       text not null check (reason in ('private', 'notWork', 'offensive', 'other')),
  created_at   timestamptz not null default now(),
  primary key (photo_id, reporter_id)
);

alter table public.work_photos enable row level security;
alter table public.work_photo_reports enable row level security;
revoke all on public.work_photos, public.work_photo_reports from anon, authenticated;

-- Who may add what, checked by the database as well as the app.
create function private.work_photos_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  d public.deals;
  pr public.proofs;
begin
  if tg_op = 'UPDATE' then
    -- only the state moves; what the photo is and whose it is never change
    if new.deal_id <> old.deal_id or new.helper_id <> old.helper_id or new.source <> old.source
       or new.uploaded_by <> old.uploaded_by or new.proof_id is distinct from old.proof_id then
      raise exception 'a work photo''s owner and origin are fixed' using errcode = '23514';
    end if;
    -- gone stays gone: removed / hidden / declined photos never come back
    if old.status in ('removed', 'hidden', 'declined') and new.status <> old.status then
      raise exception 'this photo was taken down' using errcode = '23514';
    end if;
    return new;
  end if;

  select * into d from public.deals where id = new.deal_id;
  if not found or d.type <> 'errand' or d.status <> 'released' or d.helper_id is distinct from new.helper_id then
    raise exception 'photos only of a finished job, for its helper' using errcode = '23514';
  end if;
  if coalesce((select trust from public.category_settings where category = d.category), 'open') = 'care' then
    raise exception 'no public photos of care work' using errcode = '23514';
  end if;

  if new.source = 'review' then
    if new.uploaded_by <> d.customer_id then
      raise exception 'review photos come from the task''s customer' using errcode = '23514';
    end if;
    if (select count(*) from public.work_photos w where w.deal_id = new.deal_id and w.source = 'review' and w.status in ('uploading', 'shown')) >= 3 then
      raise exception 'at most 3 review photos per task' using errcode = '23514';
    end if;
  else
    if new.uploaded_by <> d.helper_id then
      raise exception 'portfolio photos come from the task''s helper' using errcode = '23514';
    end if;
    select * into pr from public.proofs where id = new.proof_id;
    if not found or pr.deal_id <> new.deal_id or pr.uploaded_by <> new.uploaded_by or pr.removed_at is not null
       or pr.kind not in ('handover', 'progress') or coalesce(pr.mime, '') <> 'image/jpeg' then
      raise exception 'only your own photos of the work (handover / progress)' using errcode = '23514';
    end if;
    if (select count(*) from public.work_photos w where w.deal_id = new.deal_id and w.source = 'helper') >= 4 then
      raise exception 'at most 4 portfolio photos per task' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger work_photos_check before insert or update on public.work_photos
  for each row execute function private.work_photos_check();
