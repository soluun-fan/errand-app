-- In-task chat (docs/decisions.md 2026-11-14):
--   * one conversation per (task, helper): a helper released before payment keeps read access to
--     their own messages only; the next helper never sees them
--   * customers read their task's conversations; Ops reads only disputed tasks
--   * all writes go through server code (masking contacts, rate limits) — clients only read
--   * photos in a private bucket; messages deleted 90 days after the task ends (server job)

alter table public.messages
  add column helper_id   uuid references public.profiles (id),
  add column image_path  text,
  add column flags       text[] not null default '{}',
  add column seen_at     timestamptz,
  add constraint messages_text_len check (length(text) <= 1000),
  add constraint messages_has_content check (is_system or length(trim(text)) > 0 or image_path is not null),
  add constraint messages_thread check (is_system or helper_id is not null);

create index messages_thread_idx on public.messages (deal_id, helper_id, created_at);
create unique index messages_image_path_key on public.messages (image_path) where image_path is not null;

drop policy if exists "messages: participants" on public.messages;
create policy "messages: own conversation" on public.messages
  for select to authenticated using (
    helper_id = auth.uid()
    or exists (select 1 from public.deals d where d.id = messages.deal_id and d.customer_id = auth.uid())
    or (private.is_admin() and exists (select 1 from public.deals d where d.id = messages.deal_id and d.status = 'disputed'))
  );

revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Live updates: Supabase Realtime streams inserts/updates to subscribers, filtered by the RLS above.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
