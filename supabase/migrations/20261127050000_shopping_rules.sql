-- "Buy for me" safeguards (2026-11-27, owner: "lets include that practice").
--
-- * pricing_settings.max_item_budget: the most a helper may be asked to pay for items first (they
--   are repaid with their fee after the customer confirms). Bigger purchases: the customer pays the
--   shop themselves (already paid, or the shop's QR sent by the helper at the counter).
-- * platform_rules.top_up_wait_minutes: a request to pay extra for items over budget that the
--   customer doesn't answer lapses after this long, like a "no" (the helper buys within budget or
--   returns the extra items). Snapshot onto each task at posting.
alter table public.pricing_settings
  add column max_item_budget integer not null default 100000 check (max_item_budget between 0 and 10000000);
alter table public.platform_rules
  add column top_up_wait_minutes integer not null default 30 check (top_up_wait_minutes between 5 and 240);
