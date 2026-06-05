/* =====================================================================
   ProductSnap Studio — honest visual QA harness
   ---------------------------------------------------------------------
   PURPOSE
   Catch "content rendered but invisible / overflowing / stuck-hidden"
   regressions BEFORE they ship. Built after a Pass J regression where
   reveal-on-scroll left every inner-page heading at opacity:0 — and the
   old ad-hoc harness masked it by force-setting opacity:1 before each
   screenshot.

   HARD RULES (do not violate — they are why this file exists):
   1. NEVER set opacity / translate / visibility on reveal elements.
      Test the REAL DOM exactly as a user gets it.
   2. Scroll like a user (top→bottom in steps), then wait for reveal
      timers + transitions to settle, THEN assert.
   3. FAIL (non-zero exit) if any tracked element stays effectively
      invisible (opacity < 0.5) after a full scroll. An invisible heading
      is a bug, not a screenshot nuisance.
   4. Also flag horizontal overflow (content wider than viewport).

   USAGE
     node scripts/qa-visual.mjs                # all pages, all widths
     node scripts/qa-visual.mjs sketches.html  # one page
   Screenshots are written to qa-out/ for eyeballing. Exit code is the
   source of truth: 0 = clean, 1 = regression.

   Requires: playwright (npx playwright install chromium).
   ===================================================================== */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "qa-out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PAGES = process.argv[2]
  ? [process.argv[2]]
  : ["index.html", "sketches.html", "app.html", "pulse.html", "notes.html"];
const WIDTHS = [360, 390, 768, 1280];

// Elements that must end up visible. Mirrors the reveal selector in
// js/reveal.js plus the headings users complained were missing.
const TRACK =
  ".section-head, .phone-real, .screen-thumb, .pair, .teardown, " +
  ".future-card, .hub-card, .conv-card, .idea-sketch, .sketches-featured";

// Pulse fetches local JSON; under file:// that fails, so stub it.
const PULSE = JSON.parse(
  readFileSync(resolve(ROOT, "data/pulse-content.json"), "utf8")
);
let REGISTRY = {};
try {
  REGISTRY = JSON.parse(
    readFileSync(resolve(ROOT, "data/signals_registry.json"), "utf8")
  );
} catch {}

async function checkPage(browser, pageFile, width) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ P, R }) => {
      const real = window.fetch;
      window.fetch = function (u) {
        const s = String(u);
        if (s.includes("pulse-content.json"))
          return Promise.resolve(
            new Response(JSON.stringify(P), { status: 200 })
          );
        if (s.includes("signals_registry.json"))
          return Promise.resolve(
            new Response(JSON.stringify(R), { status: 200 })
          );
        return real.apply(this, arguments);
      };
    },
    { P: PULSE, R: REGISTRY }
  );

  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(e.message));

  await page.goto("file://" + resolve(ROOT, pageFile), {
    waitUntil: "load",
    timeout: 60000,
  });
  await page.waitForTimeout(800);

  // Scroll like a user — NO force-reveal.
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y <= h; y += 500) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(140);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  // Wait past reveal failsafe (1500ms) + transition (550ms).
  await page.waitForTimeout(2200);

  const result = await page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)];
    const hidden = els
      .filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.5)
      .map((e) => e.className.split(" ")[0] + " :: " + (e.textContent || "").trim().slice(0, 40));
    const docW = document.documentElement.scrollWidth;
    const viewW = document.documentElement.clientWidth;
    return {
      total: els.length,
      hidden,
      overflowX: docW - viewW > 2 ? docW - viewW : 0,
      htmlClass: document.documentElement.className,
    };
  }, TRACK);

  await page.screenshot({
    path: resolve(OUT, `${pageFile.replace(".html", "")}_${width}.png`),
    fullPage: true,
  });
  await ctx.close();

  result.jsErrors = jsErrors;
  return result;
}

const browser = await chromium.launch();
let failures = 0;
for (const pageFile of PAGES) {
  for (const width of WIDTHS) {
    const r = await checkPage(browser, pageFile, width);
    const bad = r.hidden.length || r.overflowX || r.jsErrors.length;
    const tag = bad ? "FAIL" : "ok  ";
    console.log(
      `[${tag}] ${pageFile} @ ${width}  tracked=${r.total} hidden=${r.hidden.length} overflowX=${r.overflowX}px jsErr=${r.jsErrors.length}`
    );
    if (r.hidden.length)
      r.hidden.forEach((t) => console.log("        hidden: " + t));
    if (r.jsErrors.length)
      r.jsErrors.forEach((e) => console.log("        jsError: " + e));
    if (bad) failures++;
  }
}
await browser.close();

if (failures) {
  console.error(`\nQA FAILED: ${failures} page/width combos have issues.`);
  process.exit(1);
}
console.log("\nQA PASSED: all pages render fully visible with no overflow or JS errors.");
