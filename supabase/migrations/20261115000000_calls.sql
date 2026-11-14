-- In-task voice/video calls + voice messages (docs/decisions.md 2026-11-14):
--   * calls are browser WebRTC; the handshake ("signals": offer / answer / hangup …) travels through
--     this table, NOT through open broadcast channels, so the same RLS that protects chat decides who
--     can receive it (only the two people on the call). Writes go through server code only.
--   * signals contain network addresses (ICE candidates) → server deletes them after 1 hour
--   * no call recording; the chat gets a system line (call happened / missed / duration) instead
--   * voice messages: audio files in the private chat bucket, referenced by messages.audio_path

create table public.call_signals (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.deals (id) on delete cascade,
  call_id       uuid not null,
  from_user_id  uuid not null references public.profiles (id),
  to_user_id    uuid not null references public.profiles (id),
  kind          text not null check (kind in ('offer', 'answer', 'decline', 'hangup', 'busy')),
  video         boolean not null default false,
  sdp           text check (sdp is null or length(sdp) <= 20000),
  created_at    timestamptz not null default now(),
  check (from_user_id <> to_user_id),
  check ((kind in ('offer', 'answer')) = (sdp is not null))
);
create index call_signals_to_idx on public.call_signals (to_user_id, created_at desc);
create index call_signals_call_idx on public.call_signals (call_id, created_at);

alter table public.call_signals enable row level security;
create policy "call_signals: the two people on the call" on public.call_signals
  for select to authenticated using (to_user_id = auth.uid() or from_user_id = auth.uid());
revoke all on public.call_signals from anon, authenticated;
grant select on public.call_signals to authenticated;

alter table public.messages
  add column audio_path text,
  add column audio_seconds smallint check (audio_seconds is null or audio_seconds between 1 and 300);
alter table public.messages drop constraint messages_has_content;
alter table public.messages add constraint messages_has_content
  check (is_system or length(trim(text)) > 0 or image_path is not null or audio_path is not null);
create unique index messages_audio_path_key on public.messages (audio_path) where audio_path is not null;

-- chat bucket also takes short voice clips (browsers record webm/ogg or mp4/aac)
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac']
where id = 'chat';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'call_signals') then
    alter publication supabase_realtime add table public.call_signals;
  end if;
end $$;
