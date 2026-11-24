---
name: staging-check
description: Verify a change end to end before the owner pushes — typecheck, unit + PGlite tests, a clean build against the staging project, Playwright browser tests and the screenshot audit at phone and desktop width. Use after any change to screens, server actions, the engine or migrations, and whenever asked "is it ready / does it work / can I push".
---

# Staging check

Staging is the Supabase project **errand-extra** (`ivaoltwgzxntytqnwkih`), env in `.env.staging.local`. Production is never touched here: the owner runs production `db push` and `git push` themselves.

## 1. Fast checks (always)
```
npm run typecheck
npm test            # engine + PGlite migration tests
```
Both must be clean before going further.

## 2. Database (only if `supabase/migrations/` changed)
```
npx supabase db push --remote=ivaoltwgzxntytqnwkih --yes
```

## 3. Build against staging
Always clear `.next` first — a cached stylesheet once hid a colour change:
```
rm -rf .next && npm run staging:build
```

## 4. Browser tests
Targeted (the specs that cover what changed):
```
npm run staging:e2e -- e2e/<spec>.spec.ts
```
Full suite (~15 min; run it in the background and wait for the notification):
```
npm run staging:e2e
```
`e2e/global-setup.ts` first closes "[verify]" tasks left by an interrupted run (they count toward the demo customer's 3-active-tasks limit). If many posting tests fail at `waitForURL(/\/tasks\//)`, check that limit before suspecting the code.

## 5. Screenshot audit (any UI change)
```
S=<scratchpad>/audit && rm -rf $S
AUDIT_DESKTOP=1 AUDIT_OUT=$S npm run staging:e2e -- e2e/zz-audit.spec.ts
```
- `$S/findings.json` lists overflow, broken images, raw i18n keys, unnamed controls and page errors — it must be empty (ignore `/_vercel/insights` 404s; that script only exists on Vercel).
- Look at the changed screens: `$S/<role>_<path>-390.png` (phone) and `-1280.png` (desktop). Fixed bars (tab bar, sticky CTA) appear mid-page in full-page screenshots; that is expected.
- For a rule-by-rule UI review, hand the screenshots to the `ui-reviewer` agent.

## 6. Report
Say plainly what passed and what failed (with the error), which failures were test assumptions vs real bugs, and give the owner the exact commands to ship:
```
npx supabase db push --remote     # only if there are new migrations
git add -A
git commit -m "<summary>" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
git push                          # Vercel deploys from main
```
New migrations must reach production before the code that reads them.
