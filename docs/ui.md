# UI system

Style **B** (chosen 2026-11-16 from three previews): very light warm-grey page, white cards, **orange** for the main action and prices. Layout patterns may be borrowed from apps users know (`reference/`), never their logo, colours or illustrations.

## Tokens
- Colours: page `canvas #F5F4F2` · cards/sheets/inputs `bg #FFF` · ink `#1C1917` · ink-2 `#57534E` · ink-3 `#8F8A85` · line `#E8E4DF` · fill `#EFECE8` · **brand orange `#EA580C`** (fills: main button with 18 px bold white text, progress, toggles, selected borders) · **brand-ink `#C2410C`** (orange text: prices, links, Copy/Directions) · brand-bg `#FFF1E8` (category tag, badges) · held `#0A7A60/#E7F6F1` · warn `#B54708/#FEF0E1` · danger `#C0362C/#FDECEA` · eta `#0E7F40/#E8F7EE` · route `#2F6FED`. Status colours mean status only; orange never means warning.
- Money colours: headline prices (task price, your fee, total to pay, job chips' amount, earnings available) are **brand-ink**; breakdown lines stay ink; money held by the bank stays **held green**.
- Buttons: primary = orange; secondary = white with a line border; small = near-black (e.g. Chat); chips: unselected white + border, selected near-black.
- Type: **Onest** (has every Mongolian letter; load `cyrillic-ext` or Ө/Ү fall back). Body 15 px, inputs 16 px (no iOS zoom), page titles 22–24 px bold tight, card labels 13 px semibold grey. Tabular numbers for money.
- Icons: **Lucide** (`lucide-react`), 16–22 px, stroke 2 — never emoji for UI. Category icons via `CategoryIcon` (`tile` = soft orange square).
- Radius: input 14 · CTA 16 · card/tile 20 · sheet 28 · chip full. Cards have **no border**: white on the grey page with `shadow-card`; floating things use `shadow-float`. Selected = 2px orange border.
- Spacing 4px grid, side padding 20. Touch ≥48px, CTA 56px. Shadow only on floating items: `0 4px 20px rgba(0,0,0,.08)`.
- Motion: sheets 250ms, snap 30/55/92%. Haptic on paid / matched / released. Respect reduced motion.

## Layouts
- **Redesign 2026-11-16** (research: Toss "one decision per screen", on-demand apps "task first", bottom-anchored actions): Home = greeting → "Танд юугаар туслах вэ?" → search → live task cards (dark, orange progress) → 6 category cards with today's "from" price → money card → past tasks; the main button fixed at the bottom. Posting = 4 steps, one question each (type → what → where → review). Task screens = tall map with a floating back button, the title card overlapping it as a sheet.
- **A Map+Sheet**: home, review, searching, live.
- **B Form**: ✕/← header, cards, sticky CTA. Post steps, SafePay create, dispute, verification.
- **C List**: tabs and lists.
Tab bar (floating pill, roots only): customer **Нүүр · Хэтэвч · Түүх**; helper **Ажил · Орлого · Түүх**. Chat lives inside a deal. SafePay is a home tile.

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

## Conventions in code
- Tokens live in `src/app/globals.css` (`@theme`): use `bg-ink`, `text-ink-2`, `bg-fill`, `border-line`, `text-held`… never raw colours.
- Components in `src/components/`; every one is shown in all states at **`/dev/components`** (dev only), including the deal screen in every state built from engine fixtures.
- Strings: server `const t = await getT()`, client `useT()`. Keys in `src/i18n/en.ts` (source of truth), `mn.ts` (draft).
- Money in UI comes from engine pure functions (`quoteFee`, `errandSplit`, `amountDue`) — same code the server books with. Format with `fmtMoney` → `46,000₮`.
- Map: `MapSlot` renders a neutral placeholder until a map provider is chosen (see decisions.md).
