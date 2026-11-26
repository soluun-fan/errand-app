-- A helper application may list any of the kinds of work (at least one). 2026-11-27.
--
-- The 1–6 cap dates from 2026-11-15, when there were six kinds. There are 15 now and the form lets
-- a helper tick all they do; a seventh made the database refuse the whole application, and the
-- old form said nothing (owner: "i send the info to get it checked, screen doesnt change").
-- The array is of `public.category`, so only real kinds can be stored; the upper bound is a
-- sanity limit well above the number of kinds.
alter table public.helper_applications drop constraint if exists helper_applications_categories_check;
alter table public.helper_applications
  add constraint helper_applications_categories_check
  check (purpose = 'identity' or cardinality(categories) between 1 and 50);
