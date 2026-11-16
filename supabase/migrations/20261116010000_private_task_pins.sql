-- Privacy (docs/decisions.md 2026-11-16 "Exact pins server-only before matching"):
-- The deals policy let approved helpers (feed) and applicants read open tasks straight through
-- the API — including the exact pin, pickup pin, street address and entrance/floor/door that
-- the app only shows as a ~300 m area before matching. The app never reads deals with a user's
-- own token (all reads are server code with the service role, which applies `fuzz`), so clients
-- now see only deals they take part in: customer, matched helper, seller/buyer — or Ops.
-- `private.can_see_in_feed` stays (unused) so older code paths can't fail on a missing function.

drop policy "deals: participants, admin, or helper feed" on public.deals;

create policy "deals: participants or admin" on public.deals
  for select to authenticated using (
    auth.uid() in (customer_id, helper_id, seller_id, buyer_id)
    or private.is_admin()
  );
