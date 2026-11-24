---
name: db-change
description: Add or change deal state, money rules, Ops settings or database columns safely — engine command, apply_transition, migration, PGlite tests, staging push. Use for any new deal field or command, any new Ops-editable setting, and any change under supabase/migrations or src/lib/engine.
---

# Changing deals, money or settings

Read `docs/rules.md` first for the money rules. Non-negotiables: integer tögrög, `helperNet + refund + platform == held`, illegal transitions rejected server-side, every transition writes a timeline event (and a ledger entry when money moves).

## A new deal rule or command
1. **Engine** (`src/lib/engine/`): add the command to `types.ts`, handle it in `deal.ts` (`apply()`), money through `tx.fromHold()` so the ledger stays balanced. Timed actions go in `schedule.ts` (`dueCommand`). Rule values come from the task's snapshot via `ruleOf(deal, "…")`, with defaults in `config.ts`.
2. **Tests first-class**: an engine test in `src/lib/engine/__tests__/` for the happy path, the refusals and the ledger invariant.

## A new deal column
1. Map it both ways in `src/lib/db/mapping.ts`.
2. In a new migration, **redefine `apply_transition()`** (copy the latest version, add the column, keep the grants). Writes only ever go through `runCommand()` / `insertDeal()` → this RPC (optimistic lock on `version`); never write `deals`, `ledger_entries` or `timeline_events` directly.
3. New columns are nullable or have a default, so older rows and inserts keep working.

## A new Ops setting
Every amount or limit is an Ops setting, never a constant: column in `platform_rules` or `pricing_settings` (with a `check` range) → `src/lib/rules.ts` / `src/lib/pricing.ts` → `RULE_RANGES` in `src/app/(app)/ops/actions.ts` → a field in `rules-form.tsx` → strings `opsRules.f.*` in mn and en. Snapshot it into `details.rules` at posting if it changes a task's promise.

## Migrations
- File: `supabase/migrations/<yyyymmddhhmmss>_<what>.sql`, with a header comment saying why (quote the owner when it was their call).
- `npm test` runs every migration in PGlite — add a schema test under `src/lib/db/__tests__/` for new tables, policies or functions.
- Staging: `npx supabase db push --remote=ivaoltwgzxntytqnwkih --yes`.
- **Production: never.** Tell the owner to run `npx supabase db push --remote` before pushing the code that needs it.

## Record it
A dated entry in `docs/decisions.md` for any rule the owner decided. Then run the `staging-check` skill.
