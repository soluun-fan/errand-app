# UI system

Style follows a UB super-app users already know (`reference/`): white, near-black primary button, map + bottom sheet, price shown upfront. Copy layout and patterns only, never its logo, colours or illustrations.

## Tokens
- Colours: ink `#1C1622` · ink-2 `#55505C` · ink-3 `#8E8A94` · line `#E7E6EA` · fill `#F3F3F5` · bg `#FFF` · scrim `rgba(0,0,0,.45)` · brand `#0E9F7E` (accents only) · held `#0E9F7E/#E7F6F1` · warn `#B54708/#FEF0E1` · danger `#C0362C/#FDECEA` · eta `#12A150/#E8F7EE` · route `#2F6FED`. Status colours mean status only.
- Type: Inter, tabular numbers. 12/14/16/18/20/28. 400/500/600/700.
- Radius: card 16 · input 12 · tile 18 · sheet 24 · CTA 14 · chip full. Selected card = 2px ink border.
- Spacing 4px grid, side padding 20. Touch ≥48px, CTA 56px. Shadow only on floating items: `0 4px 20px rgba(0,0,0,.08)`.
- Motion: sheets 250ms, snap 30/55/92%. Haptic on paid / matched / released. Respect reduced motion.

## Layouts
- **A Map+Sheet**: home, review, searching, live.
- **B Form**: ✕/← header, cards, sticky CTA. Post steps, SafePay create, dispute, verification.
- **C List**: tabs and lists.
Tab bar (floating pill, roots only): customer **Нүүр · Хэтэвч · Түүх**; helper **Ажил · Орлого · Түүх**. Chat lives inside a deal. SafePay is a home tile.

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
