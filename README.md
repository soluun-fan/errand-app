# Tuslamj Hub

Errand marketplace + SafePay protected payments for Ulaanbaatar. Product brief and rules: [CLAUDE.md](CLAUDE.md).
Clickable prototype: open [prototype/index.html](prototype/index.html) in a browser.

## Run it locally

Needs Node 24 and [Docker](https://docs.docker.com/get-docker/) (for the local Supabase stack).

```bash
npm install
npm run db:start          # starts Supabase in Docker, applies supabase/migrations, prints keys
cp .env.example .env.local   # paste the API URL, Publishable key and Secret key it printed
npm run seed              # demo users + one paid demo task
npm run dev               # http://localhost:3000
```

Sign in with a demo number — no SMS is sent, the code is always **123456**:

| Number | Who |
|---|---|
| 8800 0001 | Solongo B. — customer |
| 8800 0002 | Tsogt G. — customer (ДАН verified) |
| 8800 0011 | Bat-Erdene G. — helper, approved |
| 8800 0012 | Nomin A. — helper, approved |
| 8800 0013 | Temuulen M. — helper, pending approval |
| 8800 0099 | Ops team — admin |

`npm run db:reset` wipes the database and re-applies migrations (run `npm run seed` again after).

### Using a hosted Supabase project instead of Docker

1. Create a project at supabase.com, then `npx supabase login` and `npx supabase link --project-ref <ref>`.
2. `npx supabase db push` to apply the migrations.
3. Auth → Providers → Phone: enable it, configure an SMS provider (a placeholder works for test
   numbers), and add the demo numbers above under *Test phone numbers* with OTP `123456`.
4. Put the project URL and keys in `.env.local`, then `npm run seed`.

## Commands

| | |
|---|---|
| `npm test` | All tests: deal engine, mapping, and the SQL schema (runs the migrations in an in-process Postgres — no Docker needed) |
| `npm run typecheck` | TypeScript |
| `npm run dev` / `build` / `start` | Next.js |

## Layout

```
src/lib/engine/     Deal engine: state machine, money split, ledger rules. Pure, no I/O.
src/lib/db/         Row ↔ engine mapping and the deal repository (load → apply → one atomic RPC).
src/lib/supabase/   Supabase clients: user (RLS), admin (service role, server only), proxy session refresh.
src/app/            Next.js routes. /login = phone OTP sign-in.
supabase/           config.toml (phone auth + demo OTP numbers) and SQL migrations.
scripts/seed.ts     Demo data, created through the engine like real traffic.
```
