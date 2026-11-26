---
name: ui-polish
description: Build or tidy a screen so it matches Guigere's design system — tokens, Lucide icons, card style, 20 px edges, even grids, heading scale, one main action, mn/en strings, phone and desktop. Use when building any UI, when the owner says something looks inconsistent, misaligned or "not professional", or before shipping a screen.
---

# UI polish

The rules live in `docs/ui.md` (read the sections you need). This is the checklist that catches what has gone wrong before.

## Colour and type
- Tokens only (`bg-ink`, `text-ink-2`, `bg-fill`, `border-line`, `text-brand-ink`, `bg-held-bg`…), never raw hex. Defined in `src/app/globals.css`.
- Orange = the main action and prices. Status colours (held green, warn amber, danger red) mean status only. A warning is never green; orange is never a warning.
- Headline money = `text-brand-ink`, breakdown lines = ink, held money = held green. Always `fmtMoney`.
- Section titles: `text-[18px] font-bold tracking-tight md:text-[24px]`. Small group labels: `text-[13px] font-semibold text-ink-2`.

## Shapes
- Plain cards: `rounded-card bg-bg shadow-card`, **no border**. A 2 px orange border means *selected* or *your turn* only.
- Icons: Lucide. Inline with text use `<Ico as={Phone} />` (`src/components/icon.tsx`). No emoji anywhere in the UI (push notification titles may keep them).
- Touch targets ≥ 48 px (`min-h-12`), CTA 56 px.

## Layout and geometry
- Spacing scale (`space` in `src/components/ui.tsx`, docs/ui.md): `space.page` between sections, `space.blocks` on simple screens, `space.section` title → content, `space.group` inside a list. A gap between separate blocks is never smaller than the 20 px edge; things that belong together share a `gap-3` wrapper. No one-off `gap-*` / `-mt-*` to nudge a single block.
- Page edge 20 px on phones (`px-5`) — the app and the landing page alike. Swipe rows bleed with `-mx-5 px-5` so their first card lines up with the edge.
- Grids keep rows full: pick column counts that divide the item count (everyday kinds: 3 on phones, 5 wider = 2 rows of 10; licensed: one row of 3 wide tiles). Use `auto-fit` for rows whose length varies. Reuse `everydayGridClass` / `licensedGridClass` / `serviceTileClass` (`src/components/service-tile.tsx`).
- Long lists: newest few, the rest folded (`<details>` or `ExpandableGrid`) with "Бүгдийг харах (n)".
- Live/urgent notes go near the top of a screen, never under history.
- One main action per screen. Phones: the tab bar (`src/components/app-tabs.tsx`) or a `PrimaryBar`; desktop: the top bar.
- Discovery content (open requests, helpers, work photos, reviews) is desktop-only on the signed-in Home.

## Text
- Every string through i18n, in **both** `src/i18n/mn.ts` and `en.ts`. Helpers are contractors: never "цалин/ажилтан/wallet/balance".
- Dates via `fmtDateTime` / `fmtClock` (Ulaanbaatar time) — the same style everywhere ("11-р сарын 24").

## Check it
Run the `staging-check` skill's screenshot audit (step 5) and look at the 390 px and 1280 px shots of every screen you touched. For a second pair of eyes, ask the `ui-reviewer` agent.
