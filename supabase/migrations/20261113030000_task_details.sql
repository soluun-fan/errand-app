-- Task details that drive the system price and eligibility (docs/rules.md):
-- distance, entrance / floor / unit, lift, note, people, who carries, heavy item.
-- jsonb so the per-category questions can grow without a migration each time;
-- the engine validates the shape (src/lib/engine/deal.ts normalizeDetails).
alter table public.deals
  add column details jsonb not null default '{}'::jsonb
  check (jsonb_typeof(details) = 'object');
