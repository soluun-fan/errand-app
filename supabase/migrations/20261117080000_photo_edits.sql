-- Changing photos (owner, 2026-11-17: "i cant delete photo or change"):
--   * a helper may take back their own progress / handover photo while the job is in progress and
--     take a new one. Proofs are evidence, so it is only HIDDEN (removed_at / removed_by): the
--     customer no longer sees it, Ops still does. Start photos and receipts are never removed.
--   * the customer's own task photos (task_photos) can be removed or added while the task is open;
--     those are not evidence, so they are deleted outright by the server (no change needed here).
alter table public.proofs
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles (id),
  add constraint proofs_removed_pair check ((removed_at is null) = (removed_by is null)),
  add constraint proofs_removable_kind check (removed_at is null or kind in ('progress', 'handover'));
