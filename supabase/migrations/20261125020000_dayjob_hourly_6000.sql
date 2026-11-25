-- Day jobs (түр ажил): 6,000₮ an hour at least. The minimum wage rises on 2027-01-01 to
-- 1,000,000₮/month and 5,952.30₮/hour (tripartite committee decision of 2026-08-17); the 5,000₮
-- floor (20261124020000) would fall below it. Owner, 2026-11-25: "lets start then" (research item 1).
-- Helpers are contractors, but the platform's own floor must never sit under the legal hourly minimum.
update public.category_settings set min_fee = null, min_hourly = 6000 where category = 'dayjob';
