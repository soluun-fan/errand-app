-- Organisations and specialized work (docs/decisions.md 2026-11-16 "Specialized work").
--
--   Kinds of task now have a trust level (mirrors CATEGORIES in src/lib/engine/config.ts):
--     open  — any approved helper who works in it (the original six)
--     pro   — plumbing, electrical, cleaning: a worker of an approved organisation, or an
--             individual whose certificate Ops checked
--     care  — childcare, eldercare: only workers of an approved organisation (agency) who also
--             passed the criminal-record check (kyc_level 4)
--   Ops switches each kind on or off (`category_settings.live`); care starts OFF.
--
--   An organisation is a registered business (state registration number) that Ops approves for
--   some kinds of work. It adds its workers (they accept); it vouches for them per kind. When its
--   worker is assigned, the deal records `payee_org_id` and the release pays the organisation.
--
--   The engine enforces all of this; the triggers below refuse the same things at the database
--   even if app code were wrong. All new tables are server-only (service role), like KYC.
--   apply_transition v6 = v5 + payee_org_id, offers.org_id.

-- 1. kinds of task: trust (fixed) + live (Ops) ------------------------------------------------
create table public.category_settings (
  category    public.category primary key,
  trust       text not null check (trust in ('open', 'pro', 'care')),
  live        boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id)
);
insert into public.category_settings (category, trust, live) values
  ('shop', 'open', true), ('carry', 'open', true), ('queue', 'open', true), ('deliver', 'open', true),
  ('repair', 'open', true), ('other', 'open', true),
  ('plumbing', 'pro', true), ('electrical', 'pro', true), ('cleaning', 'pro', true),
  -- care work stays off until the owner decides (legal review of child / patient care first)
  ('childcare', 'care', false), ('eldercare', 'care', false);

-- trust is a safety rule from code; only `live` may change after this migration
create function private.category_trust_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trust <> old.trust or new.category <> old.category then
    raise exception 'category trust is fixed in code; only "live" can change';
  end if;
  return new;
end;
$$;
create trigger category_trust_fixed before update on public.category_settings
  for each row execute function private.category_trust_fixed();
create trigger category_settings_keep before delete on public.category_settings
  for each row execute function private.controls_keep_row();

-- 2. organisations ----------------------------------------------------------------------------
create table public.organizations (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(btrim(name)) between 2 and 80),
  -- Mongolian state registration number of a legal entity (7 digits)
  reg_number            text not null unique check (reg_number ~ '^[0-9]{7}$'),
  kind                  text not null check (kind in ('company', 'agency', 'ngo')),
  description           text check (description is null or char_length(description) <= 1000),
  area                  text check (area is null or char_length(area) <= 80),
  owner_id              uuid not null references public.profiles (id),
  requested_categories  public.category[] not null default '{}',
  -- what Ops approved it for (only pro / care kinds mean anything here)
  categories            public.category[] not null default '{}',
  status                text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  doc_path              text,               -- registration certificate in the private `kyc` bucket
  review_note           text check (review_note is null or char_length(review_note) <= 500),
  reviewed_by           uuid references public.profiles (id),
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index organizations_status_idx on public.organizations (status, created_at);
create index organizations_owner_idx on public.organizations (owner_id);

-- where the organisation is paid (like payout_accounts for people)
create table public.organization_payout_accounts (
  org_id          uuid primary key references public.organizations (id) on delete cascade,
  bank            text not null check (length(bank) between 2 and 40),
  account_number  text not null check (account_number ~ '^(MN[0-9]{18}|[0-9]{6,20})$'),
  holder_name     text not null check (length(trim(holder_name)) between 2 and 120),
  updated_at      timestamptz not null default now()
);

create table public.org_members (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  helper_id   uuid not null references public.profiles (id) on delete cascade,
  role        text not null default 'worker' check (role in ('owner', 'manager', 'worker')),
  -- the kinds of work the organisation vouches for this person in (a subset of its own)
  categories  public.category[] not null default '{}',
  status      text not null default 'invited' check (status in ('invited', 'active', 'declined', 'removed')),
  invited_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  primary key (org_id, helper_id)
);
create index org_members_helper_idx on public.org_members (helper_id, status);

-- 3. individual certificates (pro work without an organisation) --------------------------------
create table public.helper_certificates (
  id           uuid primary key default gen_random_uuid(),
  helper_id    uuid not null references public.profiles (id) on delete cascade,
  category     public.category not null,
  number       text check (number is null or char_length(number) <= 60),
  issuer       text not null check (char_length(btrim(issuer)) between 2 and 120),
  expires_on   date,
  doc_path     text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  review_note  text check (review_note is null or char_length(review_note) <= 500),
  reviewed_by  uuid references public.profiles (id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
-- one live (pending or approved) certificate per person per kind
create unique index helper_certificates_one_live on public.helper_certificates (helper_id, category) where status in ('pending', 'approved');

-- certificates are only for pro kinds (care always goes through an agency)
create function private.certificate_kind_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select trust from public.category_settings where category = new.category) is distinct from 'pro' then
    raise exception 'certificates are only for specialized trades (pro kinds)' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger helper_certificates_kind before insert or update on public.helper_certificates
  for each row execute function private.certificate_kind_check();

-- 4. who may take what ------------------------------------------------------------------------
-- Through a given organisation (p_org not null) or on their own (p_org null).
create function private.can_take_via(p_helper uuid, p_category public.category, p_org uuid, p_now timestamptz default now())
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_trust text := coalesce((select trust from public.category_settings where category = p_category), 'open');
  v_kyc integer := (select kyc_level from public.profiles where id = p_helper);
begin
  if not exists (select 1 from public.profiles p where p.id = p_helper and p.role = 'helper'
    and p.helper_status = 'approved' and (p.suspended_until is null or p.suspended_until <= p_now)) then
    return false;
  end if;
  if v_trust = 'open' then
    return p_org is null and exists (select 1 from public.profiles p where p.id = p_helper and p_category = any (p.categories));
  end if;
  if p_org is not null then
    return exists (
      select 1 from public.org_members m join public.organizations o on o.id = m.org_id
      where m.org_id = p_org and m.helper_id = p_helper and m.status = 'active' and o.status = 'approved'
        and p_category = any (m.categories) and p_category = any (o.categories)
        and (v_trust <> 'care' or o.kind = 'agency')
    ) and (v_trust <> 'care' or coalesce(v_kyc, 0) >= 4);
  end if;
  -- on their own: only pro work, with an approved certificate that hasn't expired
  return v_trust = 'pro' and exists (
    select 1 from public.helper_certificates c
    where c.helper_id = p_helper and c.category = p_category and c.status = 'approved'
      and (c.expires_on is null or c.expires_on >= (p_now at time zone 'Asia/Ulaanbaatar')::date)
  );
end;
$$;

-- In any way at all (feeds and dispatch).
create function private.helper_can_take(p_helper uuid, p_category public.category, p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.can_take_via(p_helper, p_category, null, p_now)
      or exists (
        select 1 from public.org_members m
        where m.helper_id = p_helper and m.status = 'active' and p_category = any (m.categories)
          and private.can_take_via(p_helper, p_category, m.org_id, p_now)
      );
$$;

-- 5. deals and offers carry the organisation ---------------------------------------------------
alter table public.deals add column payee_org_id uuid references public.organizations (id);
alter table public.offers add column org_id uuid references public.organizations (id);

-- Safety nets under the engine:
--   * a new task must be of a kind that is switched on
--   * an application, and an assignment, must come from someone allowed to take that kind
--     (through the organisation it names, or on their own)
create function private.deal_category_live()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'errand' and not coalesce((select live from public.category_settings where category = new.category), false) then
    raise exception 'this kind of task is not available right now' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger deals_category_live before insert on public.deals
  for each row execute function private.deal_category_live();

create function private.offer_qualified()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category public.category := (select category from public.deals where id = new.deal_id);
begin
  if (new.org_id is not null or coalesce((select trust from public.category_settings where category = v_category), 'open') <> 'open')
     and not private.can_take_via(new.helper_id, v_category, new.org_id) then
    raise exception 'helper is not qualified for this kind of task' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger offers_qualified before insert on public.offers
  for each row execute function private.offer_qualified();

create function private.assignment_qualified()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.type = 'errand' and old.held_amount > 0 and
     (new.helper_id is distinct from old.helper_id or new.payee_org_id is distinct from old.payee_org_id) then
    raise exception 'cannot change the recipient of a paid job' using errcode = '23514';
  end if;
  if new.type = 'errand' and new.helper_id is not null
     and (new.helper_id is distinct from old.helper_id or new.payee_org_id is distinct from old.payee_org_id)
     and (new.payee_org_id is not null or coalesce((select trust from public.category_settings where category = new.category), 'open') <> 'open')
     and not private.can_take_via(new.helper_id, new.category, new.payee_org_id) then
    raise exception 'helper is not qualified for this kind of task' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger deals_assignment_qualified before update on public.deals
  for each row execute function private.assignment_qualified();

-- 6. apply_transition v6 -----------------------------------------------------------------------
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
    invite_until      = case when d.invited_helper_id is null then null else r.invite_until end,
    invite_open_after = coalesce(r.invite_open_after, d.invite_open_after),
    provider_refs     = coalesce(r.provider_refs, d.provider_refs),
    payee_org_id      = r.payee_org_id
  where d.id = p_deal_id and d.version = p_expected_version
  returning d.version, d.held_amount into v_version, v_held;

  if not found then
    raise exception 'deal % changed since version % (or does not exist)', p_deal_id, p_expected_version
      using errcode = 'PT409';
  end if;

  delete from public.offers o
  where o.deal_id = p_deal_id
    and o.helper_id in (select x::uuid from jsonb_array_elements_text(p_removed_offers) as x);

  insert into public.offers (deal_id, helper_id, org_id, note, price, proposed_by, created_at)
  select p_deal_id, o.helper_id, o.org_id, coalesce(o.note, ''), o.price, coalesce(o.proposed_by, 'helper'), coalesce(o.created_at, now())
  from jsonb_to_recordset(p_new_offers) as o(helper_id uuid, org_id uuid, note text, price bigint, proposed_by text, created_at timestamptz);

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

-- 7. dispatch and the helper feed only reach people who may take the task -----------------------
create or replace function public.dispatch_candidates(p_deal_id uuid, p_max_km double precision, p_now timestamptz default now())
returns table (
  helper_id uuid,
  distance_km double precision,
  rating_sum integer,
  rating_count integer,
  completed_count integer,
  offers_30d bigint,
  won_30d bigint
)
language sql
stable
set search_path = ''
as $$
  with d as (
    select id, category, customer_id, coalesce(pickup_lat, lat) as lat, coalesce(pickup_lng, lng) as lng
    from public.deals where id = p_deal_id and type = 'errand'
  ),
  c as (
    select p.id, p.rating_sum, p.rating_count, p.completed_count, hp.radius_km,
      case when d.lat is null or hp.lat is null then null else
        6371.0 * 2 * asin(sqrt(
          power(sin(radians(hp.lat - d.lat) / 2), 2) +
          cos(radians(d.lat)) * cos(radians(hp.lat)) * power(sin(radians(hp.lng - d.lng) / 2), 2)
        ))
      end as km
    from d
    join public.profiles p on p.role = 'helper' and p.helper_status = 'approved'
      and (p.suspended_until is null or p.suspended_until < p_now)
      and private.helper_can_take(p.id, d.category, p_now)
      and p.id <> d.customer_id
    join public.helper_presence hp on hp.user_id = p.id and hp.online and hp.updated_at > p_now - interval '10 minutes'
  )
  select c.id, c.km, c.rating_sum, c.rating_count, c.completed_count,
    (select count(*) from public.dispatch_offers o where o.helper_id = c.id and o.sent_at > p_now - interval '30 days'),
    (select count(*) from public.dispatch_offers o where o.helper_id = c.id and o.status = 'won' and o.sent_at > p_now - interval '30 days')
  from c
  where (c.km is null and p_max_km >= 1000) or (c.km is not null and c.km <= p_max_km and c.km <= c.radius_km);
$$;

create or replace function public.nearby_open_deals(p_helper_id uuid, p_now timestamptz default now())
returns table (deal_id uuid, distance_km double precision)
language sql
stable
set search_path = ''
as $$
  with me as (
    select p.id, hp.lat, hp.lng, hp.radius_km
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
    join (
      select x.id, x.category, x.customer_id, coalesce(x.pickup_lat, x.lat) as lat, coalesce(x.pickup_lng, x.lng) as lng,
        x.invited_helper_id, x.invite_until, x.invite_open_after
      from public.deals x where x.type = 'errand' and x.status = 'open'
    ) d on d.customer_id <> me.id
      and private.helper_can_take(me.id, d.category, p_now)
      and (d.invited_helper_id is null or d.invited_helper_id = me.id
           or (d.invite_open_after and d.invite_until <= p_now))
  )
  select c.id, c.km from c
  where c.invited or c.km is null or c.radius_km is null or c.km <= c.radius_km
  order by c.invited desc, c.km nulls last
  limit 50;
$$;

-- 8. search words for the new kinds ------------------------------------------------------------
insert into public.category_keywords (category, word) values
  ('plumbing', 'сантехник'), ('plumbing', 'хоолой'), ('plumbing', 'бохир'), ('plumbing', 'бөглөр'),
  ('plumbing', 'ус гоож'), ('plumbing', 'усны хоолой'), ('plumbing', 'жорлон'), ('plumbing', 'plumb'),
  ('plumbing', 'pipe'), ('plumbing', 'drain'),
  ('electrical', 'цахилгаан'), ('electrical', 'розетк'), ('electrical', 'залгуур'), ('electrical', 'утас тат'),
  ('electrical', 'автомат тасл'), ('electrical', 'электр'), ('electrical', 'electric'), ('electrical', 'socket'),
  ('electrical', 'wiring'),
  ('cleaning', 'цэвэрлэгээ'), ('cleaning', 'цэвэрлүүл'), ('cleaning', 'их цэвэрлэгээ'), ('cleaning', 'clean'),
  ('childcare', 'хүүхэд хар'), ('childcare', 'хүүхэд асар'), ('childcare', 'асрагч'), ('childcare', 'хүүхэд сахи'),
  ('childcare', 'babysit'), ('childcare', 'nanny'),
  ('eldercare', 'асаргаа'), ('eldercare', 'өвчтөн'), ('eldercare', 'ахмад'), ('eldercare', 'сувилагч'),
  ('eldercare', 'caregiver'), ('eldercare', 'elder');

-- 9. server-only, like KYC ---------------------------------------------------------------------
alter table public.category_settings enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_payout_accounts enable row level security;
alter table public.org_members enable row level security;
alter table public.helper_certificates enable row level security;
revoke all on public.category_settings, public.organizations, public.organization_payout_accounts,
  public.org_members, public.helper_certificates from anon, authenticated;
revoke execute on function private.can_take_via(uuid, public.category, uuid, timestamptz) from public;
revoke execute on function private.helper_can_take(uuid, public.category, timestamptz) from public;
grant execute on function private.can_take_via(uuid, public.category, uuid, timestamptz) to service_role;
grant execute on function private.helper_can_take(uuid, public.category, timestamptz) to service_role;

-- Server-only directory lookup: filter before pagination, including credentials not in the signup categories.
create function public.qualified_helper_ids(p_category public.category)
returns table (helper_id uuid)
language sql stable set search_path = '' as $$
  select p.id from public.profiles p where private.helper_can_take(p.id, p_category);
$$;
revoke all on function public.qualified_helper_ids(public.category) from public, anon, authenticated;
grant execute on function public.qualified_helper_ids(public.category) to service_role;

-- Direct invitations use the same qualification rules as feed, offers and assignment.
create or replace function private.check_invite()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.invited_helper_id is not null and (
    new.invited_helper_id = new.customer_id or not private.helper_can_take(new.invited_helper_id, new.category)
  ) then
    raise exception 'invited helper must be an approved helper who does this kind of task' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Agency designation is required even if an operator accidentally selects a care category on a company.
alter table public.organizations add constraint organizations_care_agency
  check (kind = 'agency' or not (categories && array['childcare','eldercare']::public.category[]));
alter table public.deals add constraint deals_care_manual_choice
  check (category not in ('childcare','eldercare') or not coalesce((details->>'autoPick')::boolean, false));

-- Registration and its payout details succeed together; a failed account insert cannot strand a registration number.
create function public.register_organization(p_org jsonb, p_payout jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.organizations(name, reg_number, kind, description, area, owner_id, requested_categories, doc_path)
  select name, reg_number, kind, description, area, owner_id, requested_categories, doc_path
  from jsonb_populate_record(null::public.organizations, p_org)
  returning id into v_id;
  insert into public.organization_payout_accounts(org_id, bank, account_number, holder_name)
  select v_id, bank, account_number, holder_name
  from jsonb_populate_record(null::public.organization_payout_accounts, p_payout);
  return v_id;
end;
$$;
revoke all on function public.register_organization(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.register_organization(jsonb, jsonb) to service_role;
