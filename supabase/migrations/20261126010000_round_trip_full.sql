-- Round trip = the way back costs the same as the way there (owner, 2026-11-26: "come back to the
-- original spot would mean you'd almost double the travel, so it won't be a mere 1000₮").
-- The return leg was priced at 50% of the trip's distance part; it is now 100%. Only the default
-- value moves: a share Ops has already changed by hand is kept.
alter table public.pricing_settings alter column round_trip_bps set default 10000;
update public.pricing_settings set round_trip_bps = 10000 where round_trip_bps = 5000;
