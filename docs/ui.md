# UI system

Style **B** (chosen 2026-11-16 from three previews): very light warm-grey page, white cards, **orange** for the main action and prices. Layout patterns may be borrowed from apps users know (`reference/`), never their logo, colours or illustrations.

## Tokens
- Colours: page `canvas #F5F4F2` · cards/sheets/inputs `bg #FFF` · ink `#1C1917` · ink-2 `#57534E` · ink-3 `#8F8A85` · line `#E8E4DF` · fill `#EFECE8` · **brand orange `#CF4A0E`** (fills; owner 2026-11-26 "brighter": the brightest shade where white text still clears 4.5:1 — 4.53; main buttons, progress and toggles) · **brand-ink `#C2410C`** (orange text: prices, links, Copy/Directions) · brand-bg `#FFF1E8` (category tag, badges) · held `#0A7A60/#E7F6F1` · warn `#B54708/#FEF0E1` · danger `#C0362C/#FDECEA` · eta `#0E7F40/#E8F7EE` · route `#2F6FED`. Status colours mean status only; orange never means warning. Rating stars are filled orange (`fill-brand text-brand`) everywhere — the one decorative use.
- Money colours: headline prices (task price, your fee, total to pay, job chips' amount, earnings available) are **brand-ink**; breakdown lines stay ink; money held by the bank stays **held green**.
- Buttons: primary = orange; secondary = white with a line border; small = near-black (e.g. Chat); chips: unselected white + border, selected near-black.
- Type: **Onest** (has every Mongolian letter; load `cyrillic-ext` or Ө/Ү fall back). Body 15 px, inputs 16 px (no iOS zoom), page titles 22–24 px bold tight, card labels 13 px semibold grey. Tabular numbers for money.
- Icons: **Lucide** (`lucide-react`), 16–22 px, stroke 2 — never emoji for UI. Category icons via `CategoryIcon` (`tile` = soft orange square).
- Radius: input 14 · CTA 16 · card/tile 20 · sheet 28 · chip full. Cards have **no border**: white on the grey page with `shadow-card`; floating things use `shadow-float`. Selected = 2px orange border.
- Spacing 4px grid, side padding 20. **Spacing scale** (2026-11-26, `space` in `src/components/ui.tsx`): a bigger gap means "less related", and a gap between two separate blocks is never smaller than the 20 px page edge.
  - `space.page`: 32 / 56 px (phone / desktop) between the sections of a page (Home, landing).
  - `space.blocks`: 24 / 32 px between the blocks of a simple screen (the tab layout: Profile, Tasks, Jobs, Earnings).
  - `space.section`: 16 / 24 px from a section's title to its content, and between groups inside it.
  - `space.group`: 12 px between cards of one list, and from a label to its control. Things that belong together (a button and its fine print, two money cards) go in one wrapper with `gap-3`, so the bigger page gap doesn't pull them apart.
  - Side-by-side columns on desktop (hero + side card) are 48 px apart.
  - **Hero (Home and landing) share one shape**, `hero` in `src/components/ui.tsx`, taken from PleaseHelp: the text column is 576 px — measured so the title and paragraph end where the search box ends, in Mongolian and English — and a side card of at most 416 px on the page's right edge. The space between them is about 112 px on wide screens and never under 64 px (owner 2026-11-26: 48 px looked compressed, 208 px ridiculously large) The two are centred against each other. The search box has a thin ink border and no shadow on wider screens (phones keep the soft shadow). Chips under it are small (40 px on desktop, 44 px on phones). The search box is exactly as wide as the text above it; the paragraph fills the column (no narrower `max-w`).
  - **Landing page rhythm** (2026-11-26): every section, band or plain, has the same top and bottom padding (`sectionY`: 40 px phones, 56 px desktop), so neighbouring sections are always 80 / 112 px apart. Only "Энэ улиралд хэрэгтэй" sits at half that distance, because it belongs to the job types above it. Landing section titles are one size (24 / 32 px).
  - **Reading sizes:** card titles `text-title` (18), card text `text-body` (15) — never 13–14 for sentences people must read. Job-type names `text-body md:text-lead` (15/16). Headings inside tab screens (Profile, Tasks) are `text-title font-bold`; 13 px grey labels are only for small group labels inside a section ("Өдөр тутмын ажил").
  - **One left edge per page.** Every section's content starts on the page edge. A page-wide band (the Home and landing hero) tints the full screen width but keeps its content on that edge, never inset inside a padded panel. Only cards inset their content (16 px).
- **Type scale** (2026-11-26, `--text-*` in `src/app/globals.css`): `text-tiny` 11 · `text-caption` 12 · `text-meta` 13 · `text-small` 14 · `text-body` 15 · `text-lead` 16 (inputs) · `text-title` 18 · `text-title-lg` 20 · `text-heading` 22 (inner-page titles) · `text-headline` 24 (tab titles) · `text-display-sm` 28 (money) · `text-display` 32 · `text-display-lg` 40 · `text-hero` 52. Headings from 20 up get line height 1.25. No `text-[Npx]`, no Tailwind `text-sm/xs/lg…`, no `rounded-[Npx]`, no raw `#hex` in classes; `src/lib/__tests__/design-tokens.test.ts` fails the build if one appears. Map colours (Google Maps conventions) are tokens too: `map-pin`, `map-busy`, `map-control`, `map-ground`.
- Touch ≥48px, CTA 56px. Shadow only on floating items: `0 4px 20px rgba(0,0,0,.08)`.
- Motion: sheets 250ms, snap 30/55/92%. Haptic on paid / matched / released. Respect reduced motion.

## Layouts
- **Posting update 2026-11-19:** one expanding message box with category-specific examples and an optional editable title. Pickup and destination each show a map inline. Moving the map previews a pin, and confirming saves it. Entrance details and extra conditions expand on demand. Review exposes edits for the request and addresses/time. Preview these controls at `/dev/components`.
- **Redesign 2026-11-16** (research: Toss "one decision per screen", on-demand apps "task first", bottom-anchored actions): Home = greeting → "Танд юугаар туслах вэ?" → search → live task cards (dark, orange progress) → 6 category cards with today's "from" price → money card → past tasks; the main button fixed at the bottom. Posting = 4 steps, one question each (type → what → where → review). Task screens = tall map with a floating back button, the title card overlapping it as a sheet.
- **A Map+Sheet**: home, review, searching, live.
- **B Form**: ✕/← header, cards, sticky CTA. Post steps, SafePay create, dispute, verification.
- **C List**: tabs and lists.
Tab bar (floating pill, phone roots only, `src/components/app-tabs.tsx`): customer **Нүүр · Захиалах (orange accent) · Даалгавар · Профайл**; helper **Ажил · Орлого · Профайл** (2026-11-24). Chat lives inside a deal. SafePay is a home tile.

- Home mode belongs to the authenticated account. Old browser-wide cookies and another account's
  preference are ignored; sign-out clears it. Jobs/Earnings and Tasks/Post show navigation for
  their respective purpose even when opened from the other mode. Profile controls the preferred
  home; the customer Home tab explicitly switches back when needed. Browsing never grants worker
  approval. Tablet navigation wraps, and job titles/statuses remain readable with enlarged text.

- **D Detail** (task / job screens, `src/components/detail.tsx`): edge-to-edge map on top (`MapHero`, ~⅓ screen, route line in `route` blue) → category tag (ink pill) + status + big title (`DetailTitle`) → plain sections split by thin lines, small grey label + big value (`DetailSection`, `DetailPair` for fee | items) → addresses in grey boxes with Хуулах / Чиглэл links (`AddressBox`) → one sticky CTA. Contact = **Call | Chat** row (`ContactRow`). Borrowed layout from a Korean errand app (2026-11-16); our colours, no illustrations.

## Components (build on /dev/components, all states)
| Name | Key rules | Ref |
|---|---|---|
| PrimaryCTA | One per screen; optional 56px square left button (back/schedule); label includes amount when money moves; disabled = fill bg + one-line reason above; terms line below | 04, 07 |
| BottomSheet | Grabber, title row, scroll body, sticky footer; modal (scrim) or persistent | 02, 08 |
| SearchBar | 56px pill "Юу хийлгэх вэ?" + 📷 + →; recent chips row under it | 01 |
| ServiceTile | 4-col grid, fill bg, illustration + label; ETA badge only if ≥2 helpers nearby | 01 |
| RouteCard | Pickup/drop rows, dotted connector, ✎/map icon, swap ⇅ outside; "+ stop" (max 3) | 02, 06 |
| FilterChips | Selected = ink bg | 02 |
| AddressRow | Round icon, distance under icon, bold title, grey area line, › | 03 |
| OptionCard | Selected = bordered card; others plain rows; price right + ⓘ | 05 |
| PriceDeltaCard | Radio cards with `+1,500₮` / `+0₮` badge; total updates live | 08 |
| SplitInputs | Орц/Давхар/Тоот + Лифт (Байгаа/Байхгүй/Мэдэхгүй) + note "Ж: Орцны код…"; ger area → Хашаа fields | 08 |
| DashedAdd / ToggleRow | "+ Хаягийн дэлгэрэнгүй"; toggles like "Буцаж ирэх" | 07 |
| MapPill / RouteBubble | "~13:15-д ирнэ"; route bubbles with time + price | 04 |
| HeldBadge | 🔒 "46,000₮ банкинд хадгалагдаж байна" wherever money is held | — |
| StepTracker | Төлсөн · Олдсон · Хийж байна · Шалгах · Дууссан, times under done steps | — |
| MoneyBreakdown | Before: fee/budget/service/total. After: to helper / back to you / platform | — |
| Countdown | Warn pill, server time | — |
| PhotoCapture | Big dashed tile, ≤5 photos, compress ≤300KB, retry queue | — |
| AIDraftCard | "✨ AI ноорог": item, tags, title, price range, all editable; low confidence → note + plain form | — |
| HelperCard | Avatar, ✓ДАН, ★ · jobs, chat / masked call / ⋯ | — |
| ProofGallery | Photos with chips (receipt amount, time, 📍) | — |
| GuardBanner | Above chat input when number/cash phrase typed | — |

## Every screen
One CTA · empty/loading(skeleton)/error states · works at 320px and 130% text · Slow-3G tested · no plain phone numbers · strings in i18n.

### Reference-inspired refinement, 2026-11-24
- The owner's PleaseHelp screenshots inform the hierarchy: a clear request entry, services,
  scannable work/price cards, then real portfolios and reviews. Keep Guigere's brand and existing
  service scope; do not copy the reference's customer counts, guarantees, care categories or assets.
- Signed-in mobile Home shows at most two active cards with a link to all active tasks, six everyday
  services with an accessible expansion, then specialized services. Recent public activity stays on
  desktop. Helper discovery and finding work have explicit links on mobile; notification/install
  prompts come after the primary choices.
- Public and signed-in service choices share `ServiceTile`. Prices use a consistent position;
  long Mongolian labels wrap. Helper identity/verification appears before portfolio photos.
- Request prices, review attribution and profile values wrap instead of overflowing; headers may
  use multiple lines. Keyboard focus is visible on links, buttons, disclosures and fields.
- Dialogs have explicit close controls and viewport-bounded scrolling. The public fixed action bar
  is mobile-only, with clearance in the footer; desktop uses the sticky header's request action.
- Home labels its selected four- and five-star reviews and photo prioritization explicitly, and
  directs readers to helper profiles for review history.

## Conventions in code
- Tokens live in `src/app/globals.css` (`@theme`): use `bg-ink`, `text-ink-2`, `bg-fill`, `border-line`, `text-held`… never raw colours.
- Components in `src/components/`; every one is shown in all states at **`/dev/components`** (dev only), including the deal screen in every state built from engine fixtures.
- Strings: server `const t = await getT()`, client `useT()`. Keys in `src/i18n/en.ts` (source of truth), `mn.ts` (draft).
- Money in UI comes from engine pure functions (`quoteFee`, `errandSplit`, `amountDue`) — same code the server books with. Format with `fmtMoney` → `46,000₮`.
- Map (2026-11-24): MapLibre + OpenFreeMap, restyled Google-Maps-like in `src/lib/map-style.ts`; markers, blue dot, locate button and credit folding in `src/components/map-ui.tsx`. Pins: red = the task's place / drop-off, dark = pickup; helper = green circle; route = solid `route` blue with a white edge. Flat and north-up.
- UX pass (2026-11-24): icons inline with text use `<Ico as={Phone} />` (`src/components/icon.tsx`); no emoji anywhere in the UI (push notification titles may keep them). Plain cards never have a border (`bg-bg shadow-card`); a 2px orange border means *selected* or *your turn* (TodoCard, price offers). Location strip: amber + Retry when failing, green while shared. Long lists show the newest few and fold the rest under "See all" (`<details>`); task history is grouped by day (`TimelineList`). Live notes (on the way / late / "are you there?") sit right under the helper card, not at the bottom. Purchases default to "buy it for me, paid back by receipt".
- Even grids (2026-11-24): category tiles come in two groups everywhere (Home and the landing page) — everyday work `everydayGridClass` (3 across on phones, 5 on wider screens: 10 kinds = 2 full rows) and licensed work `licensedGridClass` (one row of 3). Every tile is centred (2026-11-26, owner liked the earlier landing page): icon on top, name and "from" price under it. Phones show 6 + a "N more" button (`ExpandableGrid`); wider screens show all. The landing page's dark bottom bar ("Нэг хүсэлт бичихэд…" + Хүсэлт бичих) shows on computers too, not only phones. Swipe rows (this season) line up with the 20 px page edge and become one even row (`auto-fit`) on wider screens. Section titles: 18 px / 24 px bold everywhere. The landing page uses the same 20 px side margin as the app. Maps keep their canvas sized to the box (`ResizeObserver`). The helper's location strip sits under the top bar.
