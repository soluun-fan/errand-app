-- More active tasks cost a little more (owner, 2026-11-18: "you can post more than 3, by making the
-- app charge higher, like adding 500"): a customer's first free_open_tasks active tasks pay the
-- normal service fee; each one beyond adds extra_task_fee to its service fee. The hard ceiling stays
-- platform_controls.max_open_tasks (10). Ops edits both at /ops/pricing.
alter table public.pricing_settings
  add column free_open_tasks integer not null default 3 check (free_open_tasks between 1 and 50),
  add column extra_task_fee integer not null default 500 check (extra_task_fee between 0 and 100000);
