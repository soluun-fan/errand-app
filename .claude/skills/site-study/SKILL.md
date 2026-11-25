---
name: site-study
description: Study another website's design to learn from it — capture its public pages at phone and desktop width (robots.txt respected), read the layout, and compare with Guigere's screens. Use when the owner shares a site/URL to learn from, says "look at this site", "how do they do X", or asks to re-check a site for changes.
---

# Studying another site

## 1. Find the pages
- `curl -sL <origin>/robots.txt` and `<origin>/sitemap.xml` — pick the public pages that matter (home, about, listing, detail, FAQ, company). Never log in, never fill forms.

## 2. Capture
```
node scripts/study-site.mjs <url> [url…]
```
Saves `reference/inspo/<host>/<yyyy-mm-dd>/<page>-390.png` and `-1280.png` plus `outline.md` (headings, buttons, links). It skips anything robots.txt disallows, waits 3 s between pages and uses the installed Chrome (as the e2e tests do). The folder is gitignored — never commit or ship other people's pages.

To see what changed since last time, capture again and compare with the previous dated folder.

## 3. Look
Read the screenshots (full-page shots are tall and get scaled down; crop with `sips -c <h> <w> --cropOffset <y> 0 in.png --out <scratchpad>/x.png` for detail) and `outline.md`. Then open our matching audit shots (`staging-check` skill → `AUDIT_DESKTOP=1 AUDIT_OUT=…`).

## 4. Report to the owner
- What they do well that fits us (pattern, why it works, where it would go in Guigere).
- What they do badly (so we don't copy it).
- A short ranked list to build, each checked against our rules: safety first (no exact addresses or phone numbers in public), real numbers only, contractor wording, mn/en strings, our tokens.

## Never
Copy their logo, illustrations, photos, text or colours. Learn the pattern; build it in Guigere's design system (`ui-polish` skill).
