-- Specialized work (docs/decisions.md 2026-11-16 "Specialized work"): five new kinds of task.
-- Enum values must be committed before anything can use them, so they get their own migration;
-- the rules for who may take them are in 20261117010000_organizations.sql.
alter type public.category add value if not exists 'plumbing';
alter type public.category add value if not exists 'electrical';
alter type public.category add value if not exists 'cleaning';
alter type public.category add value if not exists 'childcare';
alter type public.category add value if not exists 'eldercare';
-- everyday kinds (2026-11-17): day jobs, rubbish & recycling, accompanying an adult, assembly / installing
alter type public.category add value if not exists 'dayjob';
alter type public.category add value if not exists 'trash';
alter type public.category add value if not exists 'escort';
alter type public.category add value if not exists 'assembly';
