-- Day jobs (түр ажил): 5,000₮ an hour at least (owner, 2026-11-24), just above the hourly minimum
-- wage (792,000₮/month ≈ 4,714₮/h). Helpers are contractors, but the floor shouldn't sit below it.
-- Raise to ~6,000₮/h when the 2027 minimum wage (~1,000,000₮/month) takes effect — Ops: /ops/pricing.
update public.category_settings set min_fee = null, min_hourly = 5000 where category = 'dayjob';
