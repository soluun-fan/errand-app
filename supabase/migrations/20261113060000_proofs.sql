-- Photo / video proof (docs/rules.md §Proof): files live in a PRIVATE storage bucket; the app
-- uploads through short-lived signed URLs issued by the server after it checked the helper, and
-- shows them through short-lived signed read URLs. Nobody reads the bucket directly.
--
-- Each proof records fingerprints so reused / downloaded photos can be flagged:
--   sha256  exact file hash (same file sent again)
--   dhash   64-bit perceptual "difference hash" (same picture, re-saved or resized)
-- flags are hints for the customer and Ops (e.g. 'reused_photo'); they never block on their own.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

alter table public.proofs
  add column mime     text check (mime is null or mime ~ '^(image|video)/'),
  add column bytes    integer check (bytes is null or bytes > 0),
  add column sha256   text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add column dhash    text check (dhash is null or dhash ~ '^[0-9a-f]{16}$'),
  add column flags    text[] not null default '{}',
  add column ai       jsonb check (ai is null or jsonb_typeof(ai) = 'object');  -- later: OCR / vision verdicts

create index proofs_sha256_idx on public.proofs (sha256) where sha256 is not null;
create index proofs_dhash_idx on public.proofs (dhash) where dhash is not null;
create unique index proofs_file_path_key on public.proofs (file_path) where file_path is not null;
