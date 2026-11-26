import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type BrowserContext, type Page } from "@playwright/test";
import { NAMES, PHONES, db, loginAs, profile } from "./support";

/**
 * Audit crawl, on demand only: `AUDIT_OUT=<folder> npm run e2e -- e2e/zz-audit.spec.ts`. Visits every
 * screen per role at phone and desktop width and records errors, failed requests, broken images, raw
 * i18n keys and sideways overflow into <folder>/findings.json (+ phone screenshots).
 */
const OUT = process.env.AUDIT_OUT ?? join(process.cwd(), "test-results", "audit");
const NS =
  "org|cert|opsOrgs|opsCerts|specialized|common|time|tabs|mode|lang|category|categoryShort|categoryExample|status|tracker|money|helperProfile|invite|listing|opsContent|workKinds|care|web|landing|home|post|pay|deal|dispute|rating|event|task|history|wallet|earnings|details|map|job|proof|taskPhotos|chat|call|kyc|ops|safety|opsHome|opsSafety|opsIncidents|priceChange|price|direct|directPay|opsPay|conditions|badges|opsBadges|opsRules|opsPricing|push|tasksTab|profile|helper|placeholder|info|help|login|workPhotos|opsPhotos|payout|opsWithdraw|todo|error";
const RAW_KEY = new RegExp(`\\b(${NS})\\.[a-z][A-Za-z0-9_.]+\\b`);
type Finding = { who: string; path: string; width: number; kind: string; detail: string };
const findings: Finding[] = [];

async function visit(page: Page, who: string, path: string, width: number, shot: boolean) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  const errors: string[] = [];
  const onConsole = (m: import("@playwright/test").ConsoleMessage) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  };
  const onPageError = (e: Error) => errors.push(`pageerror: ${e.message.slice(0, 300)}`);
  const onResponse = (r: import("@playwright/test").Response) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes("favicon") && !u.includes("/_next/webpack-hmr")) errors.push(`http ${r.status()}: ${u.slice(0, 200)}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  try {
    const res = await page.goto(path, { waitUntil: "networkidle", timeout: 45_000 });
    if (res && res.status() >= 400) findings.push({ who, path, width, kind: "status", detail: String(res.status()) });
    await page.waitForTimeout(800);
    const info = await page.evaluate((re) => {
      const rx = new RegExp(re);
      const text = document.body.innerText;
      const raw = text.split("\n").filter((l) => rx.test(l)).slice(0, 5);
      const over = document.documentElement.scrollWidth - window.innerWidth;
      const wide = over > 1
        ? [...document.querySelectorAll("body *")]
            .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed")
            .slice(0, 3)
            .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 60)}`)
        : [];
      const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src.slice(0, 120));
      const tiny = [...document.querySelectorAll("a,button")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.height < 32 && getComputedStyle(el).visibility !== "hidden";
        })
        .slice(0, 0); // tap-size check off (noisy for inline links)
      const noName = [...document.querySelectorAll("button,a")].filter((el) => !(el.textContent ?? "").trim() && !el.getAttribute("aria-label") && !el.querySelector("img[alt]:not([alt=''])")).length;
      return { raw, over, wide, broken, tiny: tiny.length, noName, title: document.title };
    }, RAW_KEY.source);
    if (info.raw.length) findings.push({ who, path, width, kind: "raw-i18n", detail: info.raw.join(" | ") });
    if (info.over > 1) findings.push({ who, path, width, kind: "overflow", detail: `${info.over}px ${info.wide.join(", ")}` });
    if (info.broken.length) findings.push({ who, path, width, kind: "broken-img", detail: info.broken.join(" | ") });
    if (info.noName) findings.push({ who, path, width, kind: "unnamed-control", detail: String(info.noName) });
    if (shot) await page.screenshot({ path: join(OUT, `${who}${path.replace(/[/?=&]+/g, "_")}-${width}.png`), fullPage: true });
  } catch (e) {
    findings.push({ who, path, width, kind: "nav-fail", detail: String(e).slice(0, 200) });
  } finally {
    for (const e of errors) findings.push({ who, path, width, kind: "error", detail: e });
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  }
}

async function crawl(ctx: BrowserContext, who: string, paths: string[]) {
  const page = await ctx.newPage();
  for (const p of paths) {
    await visit(page, who, p, 390, true);
    await visit(page, who, p, 1280, Boolean(process.env.AUDIT_DESKTOP)); // AUDIT_DESKTOP=1: desktop screenshots too
  }
  await page.close();
}

test.setTimeout(20 * 60_000);
test.skip(!process.env.AUDIT_OUT, "on demand: set AUDIT_OUT to run the audit crawl");

test("audit crawl", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const { data: lastTask } = await db.from("deals").select("id").eq("customer_id", sol.id).eq("type", "errand").order("created_at", { ascending: false }).limit(1).single<{ id: string }>();
  const { data: lastJob } = await db.from("deals").select("id").eq("helper_id", bat.id).eq("type", "errand").order("created_at", { ascending: false }).limit(1).single<{ id: string }>();
  const { data: openJob } = await db.from("deals").select("id").eq("type", "errand").eq("status", "open").order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();

  const anon = await browser.newContext();
  await crawl(anon, "anon", ["/welcome", "/login", "/help", "/safety", "/privacy"]);
  await anon.close();

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  await crawl(customer, "customer", ["/", "/post", "/post?cat=dayjob", "/requests", "/helpers", `/helpers/${bat.id}`, "/profile", "/tasks", lastTask ? `/tasks/${lastTask.id}` : "/"]);
  await customer.close();

  const notHelper = await browser.newContext();
  await loginAs(notHelper, PHONES.solongo, { mode: "helper" });
  await crawl(notHelper, "applicant", ["/jobs", "/helper/apply"]);
  await notHelper.close();

  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat, { mode: "helper" });
  await crawl(helper, "helper", ["/jobs", "/jobs?view=all", "/earnings", "/helper/bank", "/helper/badges", "/helper/certificates", "/profile", `/helpers/${bat.id}`, lastJob ? `/jobs/${lastJob.id}` : "/jobs", openJob ? `/jobs/${openJob.id}` : "/jobs"]);
  await helper.close();

  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  await crawl(ops, "ops", ["/ops", "/ops/withdrawals", "/ops/photos", "/ops/pricing", "/ops/rules", "/ops/payments", "/ops/disputes", "/ops/content", "/ops/safety", "/ops/helpers", "/ops/badges", "/ops/certificates", "/ops/orgs", "/ops/incidents"]);
  await ops.close();

  writeFileSync(join(OUT, "findings.json"), JSON.stringify(findings, null, 2));
  console.log(`AUDIT ${findings.length} findings → ${OUT}`);
});
