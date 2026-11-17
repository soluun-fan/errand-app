-- Cover photos per kind of work (owner, 2026-11-17: "photos make it feel real and legible … i can
-- add random photos at the start"): Ops uploads one example picture per kind; cards and Home tiles
-- show it when a task has no photo of its own. These are generic pictures (never a customer's), so
-- they live in a PUBLIC bucket and can be cached. Task photos stay private as before.

alter table public.category_settings
  add column cover_path text check (cover_path is null or cover_path ~ '^[a-z]+/[0-9a-f-]{36}\.jpg$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kind-covers', 'kind-covers', true, 5242880, array['image/jpeg'])
on conflict (id) do nothing;
