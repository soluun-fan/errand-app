-- Ops may let a chosen helper work from a computer (2026-11-27, owner: "can we allow the ops to
-- decide on this stuff"). Normally going online, applying and starting a job need a phone (jobs
-- arrive as notifications to nearby helpers; customers follow the helper on the map). With this on,
-- only the phone check is skipped: notifications and a recent location are still required (desktop
-- browsers can do both). Set only by Ops through the server (no client grant); audited.
alter table public.profiles add column desktop_ok boolean not null default false;
