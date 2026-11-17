-- More photos (owner, 2026-11-17: "in the real pleasehelp app/web they constantly took pictures"):
--
--   * start    — the helper's photo when they begin (the place, the items, the queue). Required to
--                start, except for care work (no photos of children or elders). The server checks it.
--   * progress — optional photos with a short note while the job runs (a pickup, a problem found).
--   * task photos — up to 5 pictures the customer adds when posting (what to buy, fix or carry).
--     They are uploaded before the task exists, so a row is made when the upload slot is issued
--     (deal_id null) and attached when the task is posted; unattached rows older than a day are
--     deleted with their files by the background job.
--
-- Everything stays private: files in PRIVATE buckets, shown only through short-lived signed URLs
-- the server issues after checking the viewer. Photos are re-encoded in the browser (drops the
-- location metadata inside the file).

alter type public.proof_kind add value if not exists 'start';
alter type public.proof_kind add value if not exists 'progress';

alter table public.proofs
  add column note text check (note is null or char_length(note) between 1 and 140);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-photos', 'task-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create table public.task_photos (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid references public.deals (id) on delete cascade,
  file_path   text not null unique check (file_path ~ '^u/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  bytes       integer not null check (bytes > 0 and bytes <= 10485760),
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  attached_at timestamptz,
  constraint task_photos_attached check ((deal_id is null) = (attached_at is null))
);
create index task_photos_deal_idx on public.task_photos (deal_id, created_at) where deal_id is not null;
create index task_photos_loose_idx on public.task_photos (created_at) where deal_id is null;

-- at most 5 per task, and only the task's own customer may attach to it
create function private.task_photos_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deal_id is not null then
    if not exists (select 1 from public.deals d where d.id = new.deal_id and d.customer_id = new.uploaded_by) then
      raise exception 'task photos belong to the task''s customer' using errcode = '23514';
    end if;
    if (select count(*) from public.task_photos p where p.deal_id = new.deal_id and p.id <> new.id) >= 5 then
      raise exception 'at most 5 photos per task' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger task_photos_check before insert or update on public.task_photos
  for each row execute function private.task_photos_check();

-- server only (the app checks who may see a task, then signs read URLs)
alter table public.task_photos enable row level security;
revoke all on public.task_photos from anon, authenticated;
