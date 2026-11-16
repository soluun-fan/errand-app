-- Listings and direct requests (docs/decisions.md 2026-11-16 "Direct requests" and "From the database"):
--   1. Helpers describe themselves: `profiles.bio` (≤ 500 chars, contacts masked by the server
--      before saving) and an optional `profiles.from_price` ("from 8,000₮"). Public trust-card
--      fields, like name and area. Written only by server code.
--   2. Direct requests: a task sent to one helper first. Only that helper may apply while
--      the request stands; then the task opens to everyone (`invite_open_after`) or ends.
--      The engine enforces it; the helper feed below hides such tasks from everyone else.
--      apply_transition v5 = v4 + invite_until / invite_open_after + provider_refs.
--   2b. `deals.provider_refs`: every provider reference booked on a deal (pay-in, top-up, each price
--      change), so a replayed webhook for an EARLIER price change is a no-op in the engine too
--      (the unique index on pay-in refs already refused it, but as an error, not a duplicate).
--   3. Quick starts (the "popular" chips and the seasonal row) and the words that guess a
--      task's kind from search text live in tables Ops edits at /ops/content — no deploy to
--      change them. Seeded with what the code had until now.

-- 1. -------------------------------------------------------------------------------------------
alter table public.profiles
  add column bio text check (bio is null or char_length(bio) between 1 and 500),
  add column from_price integer check (from_price is null or from_price between 1000 and 10000000);

grant select (bio, from_price) on public.profiles to authenticated;

-- 2. -------------------------------------------------------------------------------------------
alter table public.deals
  add column invited_helper_id uuid references public.profiles (id),
  add column invite_until      timestamptz,
  add column invite_open_after boolean not null default true,
  add constraint deals_invite_shape check ((invited_helper_id is null) = (invite_until is null)),
  add constraint deals_invite_not_self check (invited_helper_id is null or invited_helper_id <> customer_id);

alter table public.deals add column provider_refs text[] not null default '{}';
update public.deals d set provider_refs = array(
  select x from unnest(array[d.payment_ref, d.top_up->>'provider_ref', d.price_change->>'provider_ref']) as x where x is not null
);

create index deals_invited_idx on public.deals (invited_helper_id, status) where invited_helper_id is not null;

-- Safety net under the app's own check: a request only goes to an approved helper who does this kind of task.
create function private.check_invite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.invited_helper_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.invited_helper_id and p.role = 'helper' and p.helper_status = 'approved'
      and new.category = any (p.categories)
  ) then
    raise exception 'invited helper must be an approved helper who does this kind of task' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger deals_check_invite before insert on public.deals
  for each row execute function private.check_invite();

create or replace function public.apply_transition(
  p_deal_id uuid,
  p_expected_version integer,
  p_deal jsonb,
  p_new_offers jsonb default '[]',
  p_removed_offers jsonb default '[]',
  p_dispute jsonb default null,
  p_events jsonb default '[]',
  p_ledger jsonb default '[]',
  p_suspend jsonb default '[]'
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r public.deals := jsonb_populate_record(null::public.deals, p_deal);
  v_version integer;
  v_held bigint;
  v_ledger_hold bigint;
begin
  update public.deals d set
    version           = d.version + 1,
    status            = r.status,
    held_amount       = r.held_amount,
    payment_ref       = r.payment_ref,
    check_until       = r.check_until,
    helper_id         = r.helper_id,
    match_by          = r.match_by,
    receipt_amount    = r.receipt_amount,
    item_budget       = r.item_budget,
    fee               = r.fee,
    pay_by            = r.pay_by,
    top_up            = r.top_up,
    handover_proof_at = r.handover_proof_at,
    buyer_id          = r.buyer_id,
    handed_over_at    = r.handed_over_at,
    posted_fee        = r.posted_fee,
    price_change      = r.price_change,
    -- who was invited never changes after posting; only when the request ends and whether it opens
    invite_until      = case when d.invited_helper_id is null then null else r.invite_until end,
    invite_open_after = coalesce(r.invite_open_after, d.invite_open_after),
    provider_refs     = coalesce(r.provider_refs, d.provider_refs)
  where d.id = p_deal_id and d.version = p_expected_version
  returning d.version, d.held_amount into v_version, v_held;

  if not found then
    raise exception 'deal % changed since version % (or does not exist)', p_deal_id, p_expected_version
      using errcode = 'PT409';
  end if;

  delete from public.offers o
  where o.deal_id = p_deal_id
    and o.helper_id in (select x::uuid from jsonb_array_elements_text(p_removed_offers) as x);

  insert into public.offers (deal_id, helper_id, note, price, proposed_by, created_at)
  select p_deal_id, o.helper_id, coalesce(o.note, ''), o.price, coalesce(o.proposed_by, 'helper'), coalesce(o.created_at, now())
  from jsonb_to_recordset(p_new_offers) as o(helper_id uuid, note text, price bigint, proposed_by text, created_at timestamptz);

  if p_dispute is not null and jsonb_typeof(p_dispute) = 'object' then
    insert into public.disputes (deal_id, opened_by, reason, note, outcome, decided_by, decided_at, created_at)
    select p_deal_id, x.opened_by, x.reason, coalesce(x.note, ''), x.outcome, x.decided_by, x.decided_at, coalesce(x.created_at, now())
    from jsonb_to_record(p_dispute) as x(
      opened_by uuid, reason text, note text, outcome public.dispute_outcome,
      decided_by uuid, decided_at timestamptz, created_at timestamptz
    )
    on conflict (deal_id) do update set
      outcome = excluded.outcome, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  end if;

  insert into public.timeline_events (deal_id, code, data, created_at)
  select p_deal_id, e.code, coalesce(e.data, '{}'::jsonb), coalesce(e.created_at, now())
  from jsonb_to_recordset(p_events) as e(code text, data jsonb, created_at timestamptz);

  insert into public.ledger_entries (deal_id, kind, amount, from_account, to_account, provider_ref, created_at)
  select p_deal_id, l.kind, l.amount, l.from_account, l.to_account, l.provider_ref, coalesce(l.created_at, now())
  from jsonb_to_recordset(p_ledger) as l(
    kind public.ledger_kind, amount bigint, from_account text, to_account text, provider_ref text, created_at timestamptz
  );

  update public.profiles p set suspended_until = greatest(p.suspended_until, s.until)
  from jsonb_to_recordset(p_suspend) as s(user_id uuid, until timestamptz)
  where p.id = s.user_id;

  v_ledger_hold := public.account_balance('hold', p_deal_id);
  if v_ledger_hold <> v_held then
    raise exception 'ledger hold % does not match held_amount % for deal %', v_ledger_hold, v_held, p_deal_id;
  end if;

  return v_version;
end;
$$;

-- The helper feed: as before, but a task sent to one helper shows only to them while the request
-- stands (and to them even outside their radius — the customer picked them).
create or replace function public.nearby_open_deals(p_helper_id uuid, p_now timestamptz default now())
returns table (deal_id uuid, distance_km double precision)
language sql
stable
set search_path = ''
as $$
  with me as (
    select p.id, p.categories, hp.lat, hp.lng, hp.radius_km
    from public.profiles p
    left join public.helper_presence hp on hp.user_id = p.id
    where p.id = p_helper_id and p.role = 'helper' and p.helper_status = 'approved'
      and (p.suspended_until is null or p.suspended_until < p_now)
  ),
  c as (
    select d.id,
      case when d.lat is null or me.lat is null then null else
        6371.0 * 2 * asin(sqrt(
          power(sin(radians(me.lat - d.lat) / 2), 2) +
          cos(radians(d.lat)) * cos(radians(me.lat)) * power(sin(radians(me.lng - d.lng) / 2), 2)
        ))
      end as km,
      me.radius_km,
      d.invited_helper_id = me.id as invited
    from me
    -- the helper goes to the pickup first when there is one
    join (
      select x.id, x.category, x.customer_id, coalesce(x.pickup_lat, x.lat) as lat, coalesce(x.pickup_lng, x.lng) as lng,
        x.invited_helper_id, x.invite_until, x.invite_open_after
      from public.deals x where x.type = 'errand' and x.status = 'open'
    ) d on d.category = any (me.categories) and d.customer_id <> me.id
      and (d.invited_helper_id is null or d.invited_helper_id = me.id
           or (d.invite_open_after and d.invite_until <= p_now))
  )
  select c.id, c.km from c
  where c.invited or c.km is null or c.radius_km is null or c.km <= c.radius_km
  order by c.invited desc, c.km nulls last
  limit 50;
$$;

-- 3. -------------------------------------------------------------------------------------------
create table public.quick_starts (
  id          uuid primary key default gen_random_uuid(),
  -- 'popular': chips under the search; 'seasonal': the row of cards for this time of year
  kind        text not null check (kind in ('popular', 'seasonal')),
  category    public.category not null,
  -- the task title it starts with, so the same limit as a title (engine titleMax)
  title_mn    text not null check (char_length(btrim(title_mn)) between 2 and 40),
  title_en    text not null check (char_length(btrim(title_en)) between 2 and 40),
  -- Ulaanbaatar months (1–12) it is shown in
  months      smallint[] not null default '{1,2,3,4,5,6,7,8,9,10,11,12}'
              check (cardinality(months) between 1 and 12 and months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[]),
  sort        smallint not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id)
);
create index quick_starts_kind_idx on public.quick_starts (kind, sort) where active;

insert into public.quick_starts (kind, category, title_mn, title_en, months, sort) values
  ('popular',  'shop',    'Дэлгүүрээс хүнс авчрах',              'Groceries from the store',             default, 10),
  ('popular',  'carry',   'Буйдан зөөх',                          'Move a sofa',                          default, 20),
  ('popular',  'queue',   'Дараалалд зогсох',                     'Stand in a queue',                     default, 30),
  ('popular',  'deliver', 'Бичиг баримт хүргэх',                  'Deliver documents',                    default, 40),
  ('popular',  'repair',  'Цорго засах',                          'Fix a leaking tap',                    default, 50),
  ('seasonal', 'other',   'Хашаа, гарцын цас цэвэрлэх',           'Clear snow from the yard',             '{11,12,1,2,3}', 10),
  ('seasonal', 'repair',  'Машин асаахад туслах',                 'Help start my car',                    '{11,12,1,2,3}', 20),
  ('seasonal', 'shop',    'Эмийн сангаас эм авчрах',              'Bring medicine from the pharmacy',     '{11,12,1,2,3}', 30),
  ('seasonal', 'deliver', 'Өвлийн хувцас хими цэвэрлэгээнд өгөх', 'Take winter coats to the dry cleaner', '{11,12,1,2,3}', 40),
  ('seasonal', 'shop',    'Хүйтэнд хүнс авчрах',                  'Bring groceries (it''s freezing)',     '{11,12,1,2,3}', 50),
  ('seasonal', 'carry',   'Байр нүүх',                            'Move to a new flat',                   '{4,5,6,7,8,9,10}', 10),
  ('seasonal', 'other',   'Цонх угаах',                           'Wash the windows',                     '{4,5,6,7,8,9,10}', 20),
  ('seasonal', 'repair',  'Дугуй засах',                          'Fix a bicycle',                        '{4,5,6,7,8,9,10}', 30),
  ('seasonal', 'other',   'Хашаа цэвэрлэх',                       'Tidy up the yard',                     '{4,5,6,7,8,9,10}', 40);

-- Search words → kind of task. A word matches the start of a typed word ("зөө" → "зөөх"); words
-- of 1–2 letters must match a whole word ("эм", "ор"); words with a space match as a phrase.
create table public.category_keywords (
  category    public.category not null check (category <> 'other'),
  word        text not null check (char_length(word) between 2 and 40 and word = lower(btrim(word))),
  created_at  timestamptz not null default now(),
  primary key (category, word)
);

insert into public.category_keywords (category, word) values
  ('carry', 'зөө'), ('carry', 'нүү'), ('carry', 'буйдан'), ('carry', 'диван'), ('carry', 'хөргөгч'),
  ('carry', 'тавилга'), ('carry', 'шүүгээ'), ('carry', 'ор'), ('carry', 'угаалгын машин'), ('carry', 'ачаа'),
  ('carry', 'өргө'), ('carry', 'move'), ('carry', 'sofa'), ('carry', 'fridge'), ('carry', 'furniture'), ('carry', 'carry'),
  ('queue', 'дараалал'), ('queue', 'зогсо'), ('queue', 'бүртгүүл'), ('queue', 'паспорт'), ('queue', 'үнэмлэх'),
  ('queue', 'дугаар ав'), ('queue', 'queue'), ('queue', 'line up'),
  ('repair', 'засах'), ('repair', 'засвар'), ('repair', 'цорго'), ('repair', 'гэрэл'), ('repair', 'чийдэн'),
  ('repair', 'угсар'), ('repair', 'суурилуул'), ('repair', 'залгах'), ('repair', 'өлгө'), ('repair', 'fix'),
  ('repair', 'repair'), ('repair', 'assemble'), ('repair', 'install'), ('repair', 'tap'), ('repair', 'light'),
  ('deliver', 'хүргэ'), ('deliver', 'илгээмж'), ('deliver', 'бичиг баримт'), ('deliver', 'баримт бичиг'),
  ('deliver', 'аваад'), ('deliver', 'авчирч өг'), ('deliver', 'шуудан'), ('deliver', 'deliver'),
  ('deliver', 'parcel'), ('deliver', 'document'),
  ('shop', 'дэлгүүр'), ('shop', 'хүнс'), ('shop', 'сүү'), ('shop', 'талх'), ('shop', 'супермаркет'),
  ('shop', 'номин'), ('shop', 'emart'), ('shop', 'имарт'), ('shop', 'худалдаж'), ('shop', 'авчр'),
  ('shop', 'эм'), ('shop', 'эмийн сан'), ('shop', 'grocer'), ('shop', 'shop'), ('shop', 'buy'), ('shop', 'pharmacy');

-- Server-only, like pricing_settings: pages read them with the service role.
alter table public.quick_starts enable row level security;
alter table public.category_keywords enable row level security;
revoke all on public.quick_starts, public.category_keywords from anon, authenticated;
