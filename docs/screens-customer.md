# Customer screens
Format: layout · contents · rules. Components are in `ui.md`; text in `copy.md`.

1. **Home** (A, ref 01): city ▾ + avatar · map with location pill · SearchBar + recent/"do again" chips · tiles: Дэлгүүр, Зөөх, Дараалал, Авч ирэх, Засвар, SafePay, Бүгд · pinned active-deal card (mini tracker) · "Үргэлжлүүлэх" draft chip · 3-card explainer until first completed deal.
2. **Post 1: Photo** (B): PhotoCapture tile ("Зургаа дар, бусдыг нь бид бөглөнө"), gallery, 🎤, or text. After a photo → AIDraftCard → "Зөв байна". CTA enabled with photo or ≥10 chars. Autosave draft. Target < 60 s to post.
3. **Post 2: Where & details** (B, ref 07/08): RouteCard (single row for queue/fix) · DashedAdd → SplitInputs · when chips (Одоо/Өнөөдөр/Маргааш/🗓) · category questions only: carry = floor, lift, people PriceDelta, carry-mode PriceDelta, vehicle; shop = buy-for-me + budget; deliver = size S/M/L + receiver contact · eligibility note auto-applies (e.g. 2 people) · "Мэдэхгүй" → Custom. CTA shows running total.
4. **Address picker** (sheet, ref 02/03): RouteCard, chips (Санал болгох/Ойр/Хадгалсан/Сүүлд), Гэр/Ажил slots, recent rows, search results, map pin mode. First-time address → optional entrance photo, saved.
5. **Review** (A, ref 04/05): route map + ETA pill · photo + title · OptionCards (1 helper / 2 helpers / with car; invalid ones disabled with reason) · collapsible MoneyBreakdown · HeldBadge line · discount row · CTA "Захиалга баталгаажуулах · 42,000₮" + 🗓. Custom mode: CTA "Үнийн санал авах", pay on choosing an offer.
6. **Pay** (sheet): amount, bank grid deeplinks, QR, invoice timer, "Төлбөр шалгах". Success screen 1.5 s. Failures: not received yet / expired → new invoice (never double-charge).
7. **Searching** (A): radar on pin, "Туслах хайж байна…", sent/viewed counts, free cancel. 8 min no match → "+2,000₮ нэмэх үү?". Deadline → auto refund card + "Дахин захиалах". Custom: offers as OptionCards with arrival + price, Q&A, "Сонгох".
8. **Live** (A): moving helper dot, ETA pill · StepTracker · HelperCard · HeldBadge · timeline with receipt thumb · over-budget approval sheet · ⋯ cancel (shows exact fee) / report / emergency.
9. **Check** (B): Countdown · ProofGallery · MoneyBreakdown "after" · CTA "Хийгдсэн, баталгаажуулах" · text button "Асуудал байна" → dispute form (reason chips, ≤5 photos, note ≥20 chars; money stays held).
10. **Done**: amounts moved · stars + tags · "Дахин захиалах" saves a template.
11. **Хэтэвч** (C): held now, refunds, banks, transactions.
12. **Түүх** (C): Идэвхтэй / Дууссан / SafePay; row = icon, title, date, status, amount; red dot if a check window is open.
13. **SafePay**: create (B: sell/buy toggle, photos, price, delivery PriceDelta, window 24h/3d) → share link/QR/Messenger/Viber → buyer web landing (seller trust card, item, 3 protection bullets, scam warning, pay CTA) → status tracker (Created → Paid → Sent → Received → Paid out) with role-specific text.
