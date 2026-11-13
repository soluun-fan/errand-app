# DESIGN.md — Visual language, components and screen blueprints

> **Read order for Claude Code:** `CLAUDE.md` (rules, money, data) → `UI-FLOWS.md` (flows, states, copy) → **this file** (how every screen looks and behaves).
> Where this file and UI-FLOWS.md disagree on layout or navigation, **this file wins** (it is newer).
> Reference screenshots: `reference/01–08*.png`, from a Mongolian ride-hailing / delivery super-app that UB users already use daily.

---

## 0. Why we copy this style

1. **Users already know it.** People in Ulaanbaatar use this pattern every day for taxis, delivery and food: a map on top, a "where?" search, a service grid, then bottom sheets and one dark button at the bottom. If our app works the same way, nobody has to learn anything.
2. **It is calm and readable.** It uses a white background, black text, one dark primary button, big tap areas and very few colours.
3. **It shows prices upfront.** Price and arrival time appear before you confirm, and every add-on shows its exact `+₮` cost. That matches our "money is always visible" principle.

**What we copy:** layout, patterns, spacing, component behaviour.
**What we never copy:** their logo, brand colour (yellow), illustrations/3D icons, names, or wording word-for-word. We make our own assets.

---

## 1. Pattern inventory from the reference (what each screenshot teaches)

| # | Screenshot | Pattern | We use it for |
|---|---|---|---|
| 01 | Home | Full-bleed map top ~45% · current-location pill on map ("Ардчилсан намын байр ›") · search field "Хаачих вэ? →" + horizontal recent-address chips · 4-column service grid with **ETA badge** ("3 мин ⚡") on tiles · points balance chip top-right (276) · promo carousel · **3-item floating tab bar** (Нүүр / Хэтэвч / Түүх) | Customer home |
| 02 | Address picker (empty) | Bottom sheet titled "Хаяг сонгох" · pickup/drop card with dotted connector + **swap button** · map-pin shortcut icon · **filter chips** (Санал болгох / Ойр / Хадгалсан / Сүүлд зорчсон) · **Home / Work slots** with "+" · recent list with clock icon + distance under icon · sticky dark CTA | Address step |
| 03 | Address results | Search results list: pin icon, **distance under the icon**, bold title, grey sub-line with area ("…орчимд"), chevron · clear (×) in field | Address search |
| 04 | Route + price | Route drawn on map · **two route bubbles with time + price** · "~13:15-д очно" ETA pill · option list · promo row ("Хөнгөлөлт") · preferences + priority icons · **schedule icon button + big dark confirm** · terms line under the button | Review & confirm |
| 05 | Options list | Selected option = **card with 2px black border**; others = plain rows · image left, name + ETA + one-line descriptor, price right with ⓘ | Helper-type / team-size choice |
| 06 | Delivery start | Pickup/drop card · "Үргэлжлүүлэх →" resumes an unfinished order · **saved templates** ("Хадгалсан ачааны загвар", "+ Загвар нэмэх") | Drafts + "do it again" |
| 07 | Delivery form | Address card with edit icon · contact chips (phone, pickup method) · dashed "+ Хаягийн дэлгэрэнгүй оруулах" · "+ Буулгалт нэмэх" (add stop) · **toggle row** "Буцаж ирэх" · CTA disabled grey until valid | Errand details |
| 08 | Sender sheet | Sheet over dimmed screen · **radio choice cards with price-delta badges** ("+1,000₮" / "+0₮") · **split inputs Орц / Давхар / Тоот** · extra info placeholder "Ж: Орцны код…" · back square button + primary | Floor/entrance + add-ons |

---

## 2. Design tokens

### 2.1 Colour
| Token | Value | Use |
|---|---|---|
| `ink` | `#1C1622` (near-black, slightly warm/purple like the reference CTA) | Text, primary button, selected borders |
| `ink-2` | `#55505C` | Secondary text |
| `ink-3` | `#8E8A94` | Placeholder, captions, distances |
| `line` | `#E7E6EA` | Borders, dividers |
| `fill` | `#F3F3F5` | Chips, secondary buttons, input background, disabled button |
| `bg` | `#FFFFFF` | Screens and sheets |
| `scrim` | `rgba(0,0,0,.45)` | Behind sheets |
| `brand` | **our own** e.g. `#0E9F7E` (teal-green, "safe money") | Logo, small accents only, never big areas |
| `held` | `#0E9F7E` on `#E7F6F1` | "Held safely" badges |
| `warn` | `#B54708` on `#FEF0E1` | Check window / countdown |
| `danger` | `#C0362C` on `#FDECEA` | Dispute, errors |
| `eta` | `#12A150` on `#E8F7EE` | ETA badges ("~6 мин ⚡") |
| `route` | `#2F6FED` | Map route, selected route bubble |

Rules: status colours only mean status. The primary button is always `ink`, never brand colour. Contrast is at least 4.5:1.

### 2.2 Type
- Font: **Inter** (has Cyrillic) with fallback `system-ui`. Numbers use `font-variant-numeric: tabular-nums`.
- Scale: `12` caption · `14` secondary · `16` body · `18` row title · `20` sheet title · `28` big price/amount.
- Weights: 400 body, 500 labels, 600 titles/buttons, 700 prices.
- Money format: `46,000₮` (number then ₮, as in the reference). Keep **one** format app-wide. UI-FLOWS.md used `₮46,000`; switch to `46,000₮` to match what UB users see daily.

### 2.3 Shape, spacing, elevation
- Spacing grid 4 px. Screen side padding **20 px**. Gap between blocks 16–24 px.
- Radius: cards **16**, inputs **12**, chips/pills **999** (full), service tiles **18**, sheets **24** (top corners), CTA **14**.
- Borders: 1 px `line`. Selected card: **2 px `ink`** (ref 05, 08).
- Shadows: only on floating things (sheet top edge, map buttons, tab bar): `0 4px 20px rgba(0,0,0,.08)`.
- Touch targets ≥ 48 px high. Primary CTA height **56 px**.

### 2.4 Iconography & illustration
- UI icons: one outline set (e.g. Lucide/Phosphor), 24 px, 2 px stroke, `ink`.
- Service tiles: **our own** soft 3D-style or flat illustrations (shopping bag, box + hand truck, hourglass/queue, scooter, wrench, sparkle). Commission or generate them. Do not reuse the reference's assets.
- Map pins: pickup = black circle with person glyph; drop = orange-red circle with arrow (as in ref, but in our style); helper = brand dot with pulse.

### 2.5 Motion
- Sheets slide up 250 ms ease-out, with 3 snap points (peek 30% / half 55% / full 92%).
- Buttons press-scale 0.98. Haptic on: payment confirmed, helper matched, money released.
- Searching animation = soft radar pulse on the map, not a spinner.
- Respect `prefers-reduced-motion`.

---

## 3. Layout skeletons (use these 3 everywhere)

```
A. MAP + SHEET                 B. FULL FORM                   C. FULL LIST / CONTENT
┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│ [⌂]  [route pill ✎]  │       │ ✕     Title          │       │ ←  Title        [🔍] │
│        MAP           │       │                      │       │                      │
│   (pins, route,      │       │ [card]               │       │ [section header  →]  │
│    ETA pill)    [◎]  │       │ [card]               │       │ [list rows …]        │
├───── grabber ────────┤       │ [+ dashed add]       │       │                      │
│ sheet content        │       │ [toggle row]         │       │                      │
│ (options, details)   │       │                      │       │                      │
│                      │       │                      │       │                      │
│ [🗓] [ PRIMARY CTA  ]│       │ [ ← ] [ PRIMARY CTA ]│       │                      │
│  terms line          │       └──────────────────────┘       │  ( Нүүр Хэтэвч Түүх )│
└──────────────────────┘                                      └──────────────────────┘
```
- **A** for anything location-based (home, review, searching, live tracking).
- **B** for data entry (post details, SafePay create, dispute, verification).
- **C** for tabs (Wallet, History) and lists (helper feed, deal history).
- The tab bar shows **only on the 3 root tabs**. Inside a flow, show close (✕) or back (←) instead.

---

## 4. Component specs

Each component lists **anatomy → states → rules**. Build these first (Storybook-style page at `/dev/components`).

### 4.1 `PrimaryCTA` (sticky bottom action)
- Anatomy: optional **square secondary button** 56×56 on the left (`fill` bg, icon: 🗓 schedule or ← back), then full-width dark button `ink`, white 17/600 label, optional trailing → arrow. Optional terms line under it, 12 px `ink-3`, link underlined.
- States: enabled · **disabled = `fill` bg + `ink-3` text** (ref 07) · loading (label replaced by 3-dot loader, still same width) · success flash (✓ 400 ms).
- Rules: one per screen. The label says the action **and the amount** when money moves: "Захиалга баталгаажуулах · 46,000₮". Sits above the safe-area inset. Lifts above the keyboard.

### 4.2 `BottomSheet`
- Anatomy: 24 px top radius, grabber 40×4 `line` centred 8 px from top, optional title row (← back left, centred title 20/600), content, sticky footer slot for PrimaryCTA.
- States: peek / half / full; modal (with scrim, ref 08) vs persistent (over map, ref 04).
- Rules: swipe down closes modal sheets; persistent sheets can't be dismissed, only resized. Content scrolls inside; the footer stays put.

### 4.3 `SearchBar` (home)
- Anatomy: 56 px pill, `bg` with 1 px `line` + soft shadow, 🔍 left, placeholder 18 px, → right.
- Ours: placeholder **"Юу хийлгэх вэ?"** with a 📷 camera button on the right (photo-first entry, §6.2) and the → arrow.
- Next to it: horizontal scroll of **RecentChips** (📍 + truncated address, ref 01 "Ривер плаза 51…").

### 4.4 `ServiceTile`
- Anatomy: 4-column grid, tile `fill` bg, radius 18, illustration 56 px, label 15/500 centred under it, optional **ETA badge** floating over the top edge (`eta` colours, "~6 мин ⚡"), optional corner tag (e.g. "шинэ").
- States: normal · pressed · unavailable (illustration 40% opacity, badge "Одоогоор алга").
- Rules: **show the ETA badge only when real availability data exists** (≥2 available helpers within the radius). Never show a fake or very long ETA; hide the badge instead. Last tile "Бүгд" opens the full category list.

### 4.5 `RouteCard` (pickup / drop)
- Anatomy: bordered card radius 16; rows: icon (pickup black person-pin / drop red arrow-pin), small grey label ("Авах хаяг" / "Хүргэх хаяг"), value 17/500 truncated with ellipsis; a **dotted vertical connector** between icons; right side either map-pin shortcut or ✎ edit; **swap button** (⇅) outside the card on the right (ref 02).
- Ours adds: optional third row "+ Зогсоол нэмэх" (add stop, max 3), and for single-location tasks (queue, fix) only one row: "Хаана?".

### 4.6 `FilterChips`
- Horizontal scroll, 40 px pills. Selected: `ink` bg, white text, icon. Unselected: `fill` bg.
- Address picker set: **Санал болгох · Ойр · Хадгалсан · Сүүлд**.
- Helper feed set: **Ойр · Одоо · Цаг товлосон · Худалдан авалттай**.

### 4.7 `AddressRow`
- Anatomy: 48 px circular `fill` icon (📍 / 🕘 recent / 🏠 / 💼), **distance under the icon** (12 px `ink-3`, "0.8 км"), title 17/600, sub-line 15 `ink-3` with area ("…орчимд"), chevron ›. 1 px divider indented to the text.
- Saved slots: 🏠 Гэр / 💼 Ажил with dashed icon outline and "+ Хаяг нэмэх" when empty.

### 4.8 `OptionCard` (selectable rows, ref 05)
- Selected = card with **2 px `ink` border**, radius 16. Unselected = plain row, no border.
- Anatomy: image/icon left 64 px · title 18/500 + `~2 мин` 14 `ink-3` · one-line descriptor with person icon · price 20/700 right · ⓘ opens a sheet explaining the option.
- Ours, used for **helper/team choice**: "1 туслах" · "2 туслах (хүнд эд зүйл)" · "Машинтай туслах". Also used for offer selection in Custom mode.

### 4.9 `PriceDeltaCard` (radio cards, ref 08). Use this for every add-on
- Two (max three) cards side by side or stacked; each: icon tile 48 px, radio top-right, title 17/600, description 14 `ink-3`, **delta badge bottom-right**: `+1,500₮` (`fill`) or `+0₮` (`eta` green).
- Selected = 2 px `ink` border.
- Our uses:
  - Carrying: **"Туслах өргөж гаргана" +1,500₮/давхар** vs **"Би доош гаргаж өгнө" +0₮**
  - People: **"1 хүн" +0₮** vs **"2 хүн" +15,000₮**
  - Shopping: **"Би өөрөө төлсөн" +0₮** vs **"Миний өмнөөс худалдаж авах"** → reveals budget input
  - Timing: **"Одоо"** vs **"Цаг товлох"** (no delta, or night surcharge shown as delta)
- Rule: the total on the CTA updates live when a card changes. Animate the number.

### 4.10 `SplitInputs` (Орц / Давхар / Тоот)
- 3 equal inputs with labels above, numeric keyboard, placeholders "1 / 5 / 54".
- Under it: **segmented "Лифт: Байгаа / Байхгүй / Мэдэхгүй"** (ours, needed for carrying price and eligibility).
- Then `TextArea` "Нэмэлт мэдээлэл", placeholder **"Ж: Орцны код, хаалганы өнгө, ойролцоох тэмдэг…"**.
- Ger district: the address type switches to **"Хашаа"** fields: gate colour/photo, khashaa number, landmark. No Орц/Давхар.

### 4.11 `DashedAdd`
- Full-width dashed 1.5 px `line` border, radius 12, "+ Хаягийн дэлгэрэнгүй оруулах" in `ink-3`. Tap expands into SplitInputs in place (ref 07).

### 4.12 `ToggleRow`
- Icon tile, title 17/600, sub 14 `ink-3`, iOS-style switch right (ref 07 "Буцаж ирэх").
- Ours: "Буцаж ирэх" (round trip), "Зураг нотолгоо шаардах" (default ON, locked for buying tasks), "Туслахтай урьдчилж ярих" (custom mode).

### 4.13 `MapPill` / `RouteBubble`
- MapPill: white pill with shadow, 17/600, centred over the pickup pin: **"~13:15-д ирнэ"** (helper arrival time).
- RouteBubble: when helper travel time matters (Custom mode with multiple offers), each offer's route can show a bubble "~11 мин · 6,800₮"; the selected one is `route` blue filled, others white. *(Also our bridge to the UB traffic project: travel time, not distance.)*

### 4.14 `TabBar`
- Floating pill bar, 16 px from bottom, blur background, radius 999, 3 items: **Нүүр · Хэтэвч · Түүх** (icon over label). The active item gets a white inner pill.
- Badges: red dot on Түүх when a deal needs action (check window open).
- **Chat is not a tab.** It lives inside each deal (less clutter, ties messages to money).
- Helper mode uses the same bar: **Ажил · Орлого · Түүх**. Mode switch lives in the profile avatar menu.

### 4.15 `PointsChip` (top-right of home)
- Coin icon + number ("276"). We use it for **trust/loyalty points** later. In the MVP, show the avatar only and hide points until the program exists.

### 4.16 Our own components (not in the reference, same style)
| Component | Anatomy & rules |
|---|---|
| `HeldBadge` | 🔒 + "46,000₮ банкинд хадгалагдаж байна" on `held` colours. Shows on every screen where money is held. |
| `StepTracker` | 5 dots + labels: Төлсөн · Олдсон · Хийж байна · Шалгах · Дууссан. Done = filled `ink` with time under ("14:02"); current = pulsing ring; future = `line`. |
| `MoneyBreakdown` | Rows: Туслахын хөлс / Барааны төсөв (дээд) / Үйлчилгээний шимтгэл / **Нийт** (bold, top border). After release: Туслахад / Танд буцсан / Платформ. Numbers come from the server only. |
| `Countdown` | `warn` pill "23:59:12-ийн дараа автоматаар баталгаажна". Uses server time. ⓘ explains why. |
| `PhotoCapture` | Big camera tile (dashed, 1:1, "📷 Зураг авах"), plus "Цомгоос сонгох", up to 5 thumbs with × remove; upload progress ring on each thumb; retry on fail (3G!). |
| `AIDraftCard` | Card with small "✨ AI ноорог" tag: detected item ("Угаалгын машин"), tags ("Том цахилгаан бараа · 2 хүн"), suggested title and price range. Each field editable inline; "Зөв байна" CTA. Low confidence → amber note "Сайн танигдсангүй, тайлбар нэмнэ үү". |
| `HelperCard` | Avatar 56, name 18/600, ✓ ДАН badge, ★4.9 · 128 ажил, vehicle/equipment chips; actions row: 💬 Чат · 📞 Залгах (masked) · ⋯ |
| `ProofGallery` | Grid of proof photos with caption chips ("Баримт · 3,250₮", "Хүлээлгэн өгсөн · 14:31 · 📍"). Tap = full-screen viewer. |
| `GuardBanner` | Amber banner above the chat input: "Апп-аас гадуур төлбөл хамгаалалт алга болно". Appears when a phone/account/cash phrase is typed. |

---

## 5. Screen blueprints (customer)

Wireframes are schematic; sizes come from §2 and §4. Mongolian copy is the default; English is in the i18n file.

### 5.1 Home (skeleton A, ref 01)
```
┌──────────────────────────────┐
│ [logo] Улаанбаатар ▾   (👤)  │  ← city selector, avatar (points later)
│            MAP               │
│   (● Сүхбаатар, 1-р хороо ›) │  ← current-location pill, tap = edit
│      helper dots (if ≥2)  [◎]│
├──────── grabber ─────────────┤
│ [🔍 Юу хийлгэх вэ?   📷  →]  │  ← camera = photo-first post
│ [📍 Гэр] [📍 Ривер плаза…] → │  ← recent / saved chips
│ ┌────┐┌────┐┌────┐┌────┐     │
│ │🛍 6м││📦  ││⏳ 4м││🛵 3м│   │  ← ServiceTiles with ETA badge
│ │Дэлгүүр│Зөөх│Дараалал│Авч ирэх│
│ ┌────┐┌────┐┌────┐           │
│ │🔧  ││🔒  ││ ⋯  │           │
│ │Засвар│SafePay│Бүгд│        │  ← SafePay is a tile, not a tab
│ ── Active deal (if any) ──── │
│ [● Бат-Эрдэнэ ирж байна ›]   │  ← mini StepTracker card, pinned
│ ── Яаж ажилладаг вэ ──────── │  ← 3-card explainer for first-timers
│     ( Нүүр  Хэтэвч  Түүх )   │
└──────────────────────────────┘
```
Small details:
- The active deal card is pinned above the grid while a deal is live; the explainer cards disappear after the first completed deal.
- An unfinished draft shows a chip "Үргэлжлүүлэх: Угаалгын машин зөөх →" (ref 06).
- "Дахин захиалах" chips from past deals come before recent addresses.

### 5.2 Post step 1: Photo-first (skeleton B)
```
┌──────────────────────────────┐
│ ✕        Шинэ захиалга   1/3 │
│ ┌──────────────────────────┐ │
│ │   📷  Зураг авах          │ │  ← big PhotoCapture tile
│ │  Зургаа дар, бусдыг нь    │ │
│ │  бид бөглөнө              │ │
│ └──────────────────────────┘ │
│ [Цомгоос сонгох] [🎤 Хэлэх]  │
│ ── эсвэл ──                  │
│ [ Бичээд тайлбарлах … ]      │  ← text fallback, prefilled from home search
│                              │
│ [ ← ] [   Үргэлжлүүлэх   ]   │  ← disabled until photo OR ≥10 chars
└──────────────────────────────┘
```
After capture → **AIDraftCard** appears in the same screen. The user edits or taps "Зөв байна". Category chosen on home pre-sets the AI's category hint.

### 5.3 Post step 2: Where & details (skeleton B, ref 07 + 08)
```
┌──────────────────────────────┐
│ ←      Хаана, хэзээ?    2/3  │
│ ┌ RouteCard ───────────────┐ │
│ │ ● Авах: 45-р байр…     ✎ │ │
│ │ ┆                        │ │
│ │ ● Хүргэх: Хаашаа?    🗺  │ │ [⇅]
│ └──────────────────────────┘ │
│ [+ Хаягийн дэлгэрэнгүй]      │  ← DashedAdd → SplitInputs + Лифт
│ [+ Зогсоол нэмэх]            │
│ Хэзээ: (Одоо) (Өнөөдөр) (Маргааш) (🗓)  │
│ ── Нэмэлт (carry only) ──    │
│ [PriceDelta: Өргөж гаргана +1,500₮/давхар | Би гаргана +0₮] │
│ [PriceDelta: 1 хүн +0₮ | 2 хүн +15,000₮]                     │
│ ── Нэмэлт (shop only) ──     │
│ [PriceDelta: Худалдаж авах → Төсөв ____₮]                    │
│ [ToggleRow: Буцаж ирэх]      │
│ [ ← ] [ Үргэлжлүүлэх · ~38,000₮ ] │
└──────────────────────────────┘
```
Small details:
- Tapping an address row opens the **Address picker sheet** (§5.4).
- The questions shown depend on category (§8.2), never all at once.
- If the job fails an eligibility rule (e.g. "fridge, 5th floor, no lift, 1 person"), show an amber inline note: "Энэ ажилд 2 хүн хэрэгтэй" and auto-select 2 people. The user can override only with "Мэдэхгүй / зурагнаас шалгуулах" → Custom mode.

### 5.4 Address picker (bottom sheet, ref 02 + 03)
```
┌──────────────────────────────┐
│ ←        Хаяг сонгох         │
│ ┌ RouteCard (focused row) ─┐ │ [⇅]
│ FilterChips: (Санал болгох)(Ойр)(Хадгалсан)(Сүүлд) │
│ 🏠 Гэр      Хаяг нэмэх    +  │
│ 💼 Ажил     Хаяг нэмэх    +  │
│ 🕘 60-р байр           ›     │
│ 3.1км Хороолол Парадокс      │
│ …                            │
│ [   Энэ хаягаар үргэлжлүүлэх →  ] │
└──────────────────────────────┘
```
Small details:
- Typing switches the list to search results (ref 03).
- "🗺 Газрын зураг дээр сонгох" opens a full map with a centre pin; the address under the pin updates as the map moves.
- After choosing, ask for an **entrance photo** for first-time addresses (optional, saved to the address and reused next time).

### 5.5 Post step 3: Review & confirm (skeleton A, ref 04 + 05)
```
┌──────────────────────────────┐
│ [⌂] [Авах → Хүргэх      ✎]   │
│      MAP with route          │
│     (~14 мин-д ирнэ)    [◎]  │
├──────── grabber ─────────────┤
│ [AI photo thumb] Угаалгын машин 5-р давхарт  │
│ ┌ OptionCard (selected) ───┐ │
│ │ 👥 2 туслах  ~9 мин  41,000₮ ⓘ │
│ └──────────────────────────┘ │
│   1 туслах   ~4 мин   26,000₮ (disabled: "хүнд") │
│ MoneyBreakdown (collapsed ▾) │
│ 🔒 Мөнгө банкинд хадгалагдана, та баталгаажуулсны дараа шилжинэ │
│ [Хөнгөлөлт ▴]  [⚙ Тохиргоо]  │
│ [🗓] [Захиалга баталгаажуулах · 42,000₮] │
│  Баталгаажуулснаар үйлчилгээний нөхцөл…  │
└──────────────────────────────┘
```
Rules:
- Price = system suggestion. The customer may raise it with a ± stepper inside ⓘ (never below the suggestion in Instant mode).
- **Custom mode** (§8.1) replaces the price with "Үнийн санал авах" and the CTA becomes "Санал хүсэх · 0₮ одоо". Payment is collected when an offer is chosen.

### 5.6 QPay sheet
```
│ 42,000₮ төлөх                 │
│ [Хаан][Голомт][ХХБ][Төрийн][М банк][Хас] ← bank grid, tap = deeplink │
│ ── эсвэл QR уншуулах ──  [QR] │
│ Нэхэмжлэл 29:41 хүчинтэй      │
│ [ Төлбөр шалгах ]             │
```
Success: full-screen ✓ "42,000₮ банкинд аюулгүй хадгалагдлаа" (1.5 s) → Searching. Failure states are as in UI-FLOWS.md §4 C3.

### 5.7 Searching (skeleton A)
- Map with **radar pulse** on the pickup pin; MapPill "Туслах хайж байна…".
- Sheet: HeldBadge, "Ойролцоох 4 туслахад илгээлээ · 2 үзсэн", the order summary, text button "Цуцлах (үнэгүй)".
- After 8 min with no match: nudge card "Хөлсөө +2,000₮ нэмэх үү?" with one-tap raise.

### 5.8 Live deal (skeleton A)
```
│ MAP: helper dot moving → pickup; MapPill "~13:24-д ирнэ" │
├── sheet ──
│ StepTracker ●━●━◉━○━○                          │
│ HelperCard: Бат-Эрдэнэ ✓ДАН ★4.9·128   [💬][📞][⋯] │
│ HeldBadge                                       │
│ Timeline: 14:31 Баримт · 3,250₮ [thumb]         │
│           14:20 Дэлгүүрт ирлээ                  │
```
- Receipt over budget → modal sheet with PriceDeltaCard "Зөвшөөрөх +500₮ / Татгалзах".
- ⋯ → Цуцлах (shows the exact fee consequence), Асуудал мэдэгдэх, Яаралтай тусламж.

### 5.9 Check & confirm (skeleton B)
- Header: Countdown pill.
- ProofGallery.
- MoneyBreakdown in **"after release" form**: "Туслахад 39,250₮ · Танд буцах 1,750₮".
- CTA: **"Хийгдсэн, баталгаажуулах"**; text button under it: "Асуудал байна" → dispute form (skeleton B, reason chips, photos, required note).

### 5.10 Done & rate
- Big ✓, "39,250₮ Бат-Эрдэнэд шилжлээ · 1,750₮ танд буцлаа".
- 5 stars + tag chips (Цагтаа · Болгоомжтой · Найрсаг · Харилцаа сайн / Хоцорсон · …).
- "Дахин захиалах" saves the deal as a **template** (ref 06 "Загвар").

### 5.11 Хэтэвч (Wallet), skeleton C
- Top card: **"Хадгалагдаж буй 42,000₮"** (in open deals) and **"Буцаалт 1,750₮"** (sent to bank account), each tappable to its deals.
- Payment methods (linked banks), payout account (helpers), transaction list with HeldBadge / released / refunded pills.

### 5.12 Түүх (History), skeleton C
- Segmented: **Идэвхтэй · Дууссан · SafePay**.
- Deal row: category illustration, title, date, status pill, amount. Swipe = "Дахин захиалах".

### 5.13 SafePay (from home tile)
- Create (skeleton B): toggle "Зарж байна / Авч байна", item photos (PhotoCapture), price (big numeric), delivery method PriceDeltaCards (Биечлэн уулзах / Хүргэлт / Шуудан), check window chips (24 цаг / 3 хоног). CTA "Холбоос үүсгэх".
- Share sheet: link + QR + Messenger/Viber/Copy.
- Buyer web landing: seller trust block (✓ДАН, safe deals count, complaints), item card, 3-bullet protection explainer, red scam warning, CTA "46,000₮ аюулгүй төлөх".

---

## 6. Screen blueprints (helper)

### 6.1 Ажил (feed), skeleton C with a map header toggle
- Top: **availability switch** "Ажил авч байна" + duration chips "(1 цаг) (2 цаг) (Өнөөдөр)" + radius chip "3 км ▾" + "Доод хөлс 8,000₮".
- FilterChips (§4.6). Job card: illustration, title, **fee 22/700**, "+ бараа 5,000₮ хүртэл", travel time (not km): "🛵 ~7 мин", photo thumbs, "🔒 Мөнгө төлөгдсөн", applicants "2/5".
- Empty state: illustration + "Ойролцоо ажил алга. Радиусаа томсгох уу?" [3 → 5 км].

### 6.2 Job detail (skeleton A)
- Map with route from helper → pickup → drop. Customer photos big. What you earn, in a MoneyBreakdown: "Хөлс 40,000₮ − 10% = **36,000₮** + барааны зардал буцаан олгоно".
- Required equipment/eligibility shown as chips ("2 хүн", "Тэрэг"). If the helper lacks one, the CTA is disabled with the reason ("Танд 2 дахь хүн бүртгэлгүй").
- CTA: Instant "Хүлээж авах" · Custom "Үнийн санал өгөх" (sheet: price, arrival window, equipment, message).

### 6.3 Active job (skeleton A)
- StepTracker for the helper's own checklist (per category).
- Big step rows; current step expanded with its action: "Баримтын зураг авах" (camera → **auto-reads total**, user confirms number), "Хүлээлгэн өгсөн зураг" (time + GPS stamped).
- CTA "Дуусгаад илгээх" disabled until the required proof exists.

### 6.4 Орлого (earnings)
- Available / Waiting for confirmation / Withdraw CTA (same-name account), history list, commission shown per job.

---

## 7. Interaction and polish details

- **Draft persistence:** every post step autosaves; reopening the app shows "Үргэлжлүүлэх" (ref 06).
- **Keyboard:** numeric keyboards for money/floor/phone; the CTA rides above the keyboard; Next on the keyboard moves to the next SplitInput.
- **Disabled CTA always explains why** in one grey line above it ("Хүргэх хаягаа сонгоно уу").
- **Loading:** skeleton blocks shaped like the final content; no full-screen spinners.
- **3G-first** (the reference screenshots show 3G): images compressed client-side to ≤ 300 KB, uploads queued with retry, map tiles cached, app usable with the map still loading.
- **Empty states:** illustration + one line + one action.
- **Errors:** inline under the field in `danger` 14 px; network errors as a top banner with "Дахин оролдох".
- **Accessibility:** labels on icon buttons; status never shown by colour alone (icon + text); text scales to 130% without breaking (test long Mongolian words at 320 px width).
- **Privacy:** phone numbers never shown in plain text (the reference shows the sender's number; we don't). Calls go through a masked relay; home photos are deleted after the dispute window.

---

## 8. Product decisions behind these screens (from the latest review)

### 8.1 Two modes by task complexity (replaces "Now vs Scheduled")
| Mode | When | Price | Matching |
|---|---|---|---|
| **Instant** | Standard, low-risk tasks: shopping, pickup, queue, light carry (≤ 1 person, known floor/lift) | System-calculated, shown upfront, customer may raise | Sent to eligible + available helpers; first to accept |
| **Custom** | Heavy/bulky, unclear size, repairs, anything "Мэдэхгүй" | Helpers quote (price + arrival window + equipment) | Up to 5 offers; customer compares (OptionCard list) and pays on choosing |

Timing (now / later) is a separate field in both modes.

### 8.2 Required questions per category (shown only when relevant)
| Category | Must ask | Eligibility effect |
|---|---|---|
| Carry / move | Item photo, floor (from & to), lift yes/no/unknown, quantity, vehicle needed? | Heavy + no lift + floor > 2 → 2 people; vehicle → car-owning helpers only; unknown → Custom |
| Shopping | Store or "any nearby", list/photo of list, budget | Budget > 100k → helper level ≥ 2 |
| Pick up & deliver | Pickup + drop, item size (S/M/L), contact at the other end | L → vehicle |
| Queue | Place, expected wait, what to do at the front | Long waits priced per hour |
| Fix | Photo, problem type | Always Custom in MVP |

### 8.3 Photo-first + AI draft: rules
- AI **suggests**, the user **confirms**. Nothing is auto-submitted.
- AI may fill: category, item name, size class, suggested people count, title, price range.
- AI must **not** decide: weight, whether it fits the stairwell, safety. Those stay as questions.
- Low confidence → fall back to the normal form plus a note.
- Photos are private: visible to matched/applying helpers and Ops only; deleted after the dispute window closes.
- Measure: median time-to-post (target **< 60 s** for Instant tasks) and post-completion rate.

### 8.4 Helper availability (worker-friendly)
- Helpers switch on "available for 1 h / 2 h / today", set radius and minimum fee; **no penalty for declining**.
- New helpers get a fair share of job offers (small boost until 10 completed jobs).
- MVP matching is simple: **eligibility filter → available → nearest by travel time → first to accept**. No weighted scoring until we have about 200 completed jobs of data.

### 8.5 Where the reference app overlaps us, and how we differ
The reference super-app already does A→B delivery (courier comes inside, multi-stop, round trip) and cargo. **Don't compete on plain A→B.** Our screens should lead with what it doesn't do:
1. **Buy for me with a budget** (receipt photo checked against budget, unspent money auto-refunded).
2. **Hands-on tasks**: carrying upstairs, waiting in queues, helping hands, small fixes.
3. **Held payment + photo proof + dispute process** on every deal.
4. **SafePay** for buying from strangers.

Home tile order reflects this: Дэлгүүр · Зөөх · Дараалал · Авч ирэх · Засвар · SafePay · Бүгд.

---

## 9. Build plan for Claude Code (UI work)

1. **Tokens & theme** (§2) as CSS variables / Tailwind config. Font, colours, radii, shadows.
2. **Primitives** (§4.1–4.15) + our components (§4.16) on a `/dev/components` page, each in all its states.
3. **Layout skeletons** A/B/C (§3) as reusable layout components, plus the TabBar.
4. **Customer flow with mock data:** Home → Photo-first → Details → Address sheet → Review → QPay mock → Searching → Live → Check → Done (§5.1–5.10). Drive the states from fixtures and MockProvider.
5. Wallet + History tabs (§5.11–5.12).
6. Helper screens (§6).
7. SafePay create/share/landing (§5.13).
8. Polish pass (§7): drafts, keyboard, skeletons, 3G image compression, a11y, 320 px test.
9. MN copy review by a native speaker; EN via i18n.
10. Visual QA: put each built screen next to the matching `reference/*.png` and check spacing, sizes, hierarchy (not colours or branding).

### Acceptance checklist per screen
- [ ] Matches its skeleton (A/B/C) and the component specs
- [ ] One primary CTA; disabled state explains why
- [ ] Any money shown comes from the server and matches the ledger; HeldBadge where funds are held
- [ ] Empty / loading / error states built
- [ ] Works at 320 px wide and with 130% text
- [ ] All strings in i18n (mn default)
- [ ] No phone number visible in plain text
- [ ] Tested on a throttled "Slow 3G" profile
