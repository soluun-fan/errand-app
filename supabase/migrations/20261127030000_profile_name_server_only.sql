-- Display names change only through the app's server (onboarding / profile), which cleans them
-- (cleanDisplayName: length, letters, no look-alike "Ops" names). 2026-11-27 reliability review.
--
-- 20261112000000 granted signed-in users `update (name, area)` on their own profile row, so anyone
-- could PATCH any name straight through the database API — "Guigere Ops", a 500-character name —
-- and it would show in other people's screens and notifications. Nothing in the app uses that
-- grant (every write goes through the service role), so it is withdrawn.
revoke update (name, area) on public.profiles from authenticated;
