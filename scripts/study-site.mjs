#!/usr/bin/env node
/**
 * Capture another website's public pages for design study (the `site-study` skill).
 *
 *   node scripts/study-site.mjs https://example.com/ https://example.com/about
 *
 * For each URL: a full-page screenshot at phone (390) and desktop (1280) width, plus an outline
 * (headings, buttons, links) in outline.md. Output: reference/inspo/<host>/<yyyy-mm-dd>/ (gitignored —
 * other people's pages are for looking at, never for shipping).
 *
 * Polite by design: obeys robots.txt (User-agent: *), one page at a time, 3 s between pages, public
 * pages only (no login, no cookies kept).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const WIDTHS = [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "1280", width: 1280, height: 800, mobile: false },
];
const PAUSE_MS = 3000;
const UA = "Mozilla/5.0 (compatible; design-study; +robots-respecting)";

/** Disallow prefixes for `User-agent: *` (wildcards `*` supported; Allow lines that are longer win). */
async function robotsRules(origin) {
  const res = await fetch(`${origin}/robots.txt`).catch(() => null);
  if (!res?.ok) return { allow: [], disallow: [] };
  const rules = { allow: [], disallow: [] };
  let forAll = false;
  for (const raw of (await res.text()).split("\n")) {
    const [key, ...rest] = raw.split("#")[0].split(":");
    const value = rest.join(":").trim();
    const k = key.trim().toLowerCase();
    if (k === "user-agent") forAll = value === "*";
    else if (forAll && (k === "allow" || k === "disallow") && value) rules[k].push(value);
  }
  return rules;
}

const toRegex = (rule) => new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
function allowed(rules, pathAndQuery) {
  const match = (list) => list.filter((r) => toRegex(r).test(pathAndQuery)).reduce((a, r) => Math.max(a, r.length), -1);
  return match(rules.allow) >= match(rules.disallow);
}

const slug = (u) => (u.pathname + u.search).replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "-") || "home";
const today = new Date().toISOString().slice(0, 10);

const urls = process.argv.slice(2).map((u) => new URL(u));
if (!urls.length) {
  console.error("Usage: node scripts/study-site.mjs <url> [url…]");
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome" }); // the installed Chrome, as the e2e tests use
const outline = [];
const robots = new Map();
try {
  for (const [i, url] of urls.entries()) {
    if (!robots.has(url.origin)) robots.set(url.origin, await robotsRules(url.origin));
    if (!allowed(robots.get(url.origin), url.pathname + url.search)) {
      console.log(`skip (robots.txt): ${url}`);
      continue;
    }
    const dir = join("reference", "inspo", url.hostname, today);
    await mkdir(dir, { recursive: true });
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, isMobile: w.mobile, hasTouch: w.mobile, userAgent: UA });
      const page = await ctx.newPage();
      await page.goto(url.href, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => page.waitForLoadState("load"));
      // Scroll through once so lazy images load before the full-page shot.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(800);
      const file = join(dir, `${slug(url)}-${w.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`saved ${file}`);
      if (w.mobile) {
        const o = await page.evaluate(() => {
          const txt = (el) => el.innerText.replace(/\s+/g, " ").trim().slice(0, 80);
          return {
            title: document.title,
            headings: [...document.querySelectorAll("h1,h2,h3")].map((h) => `${h.tagName.toLowerCase()} ${txt(h)}`).filter((s) => s.length > 3),
            buttons: [...new Set([...document.querySelectorAll("button,[role=button]")].map(txt).filter(Boolean))],
            links: [...new Set([...document.querySelectorAll("a[href]")].map((a) => `${txt(a)} → ${a.getAttribute("href")}`).filter((s) => !s.startsWith(" →")))],
          };
        });
        outline.push(`## ${url.href}\n_${o.title}_\n\n### Headings\n${o.headings.map((h) => `- ${h}`).join("\n")}\n\n### Buttons\n${o.buttons.map((b) => `- ${b}`).join("\n")}\n\n### Links\n${o.links.slice(0, 60).map((l) => `- ${l}`).join("\n")}\n`);
      }
      await ctx.close();
    }
    if (i < urls.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
} finally {
  await browser.close();
}
if (outline.length) {
  const dir = join("reference", "inspo", urls[0].hostname, today);
  await writeFile(join(dir, "outline.md"), `# ${urls[0].hostname} — ${today}\n\n${outline.join("\n")}`);
  console.log(`saved ${join(dir, "outline.md")}`);
}
