#!/usr/bin/env node
/* ========================================================================
   Track 2 unit test: buildUpdateFromSeries now produces a 36-month window
   and enriched compared_to (vs_1mo / vs_36mo / range_36mo).

   Feeds a synthetic 40-month prepared series through the fetcher's own
   buildUpdateFromSeries + validateUpdate (extracted via vm sandbox without
   running main()), and asserts:
     - data_points carries 36 points (the trailing 36 months)
     - data_points_window_months === 36
     - compared_to has vs_1mo, vs_6mo, vs_12mo, vs_36mo, vs_pre_2020, range_36mo
     - range_36mo high/low/dates are correct for the window
     - validateUpdate accepts the enriched update
     - a SHORT series (15 months) still produces a valid update with <36 points
       and window_months reflecting the real count (never fabricated)

   Dependency-free, offline. Exit 0 = pass.
   ======================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const FETCHER_PATH = path.join(ROOT, "scripts", "fetch-pulse-data.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function loadFetcherInternals() {
  let src = fs.readFileSync(FETCHER_PATH, "utf8");
  const idx = src.indexOf("main().catch(");
  if (idx !== -1) src = src.slice(0, idx) + "/* main disabled */\n";
  src += `
;module.exports = {
  buildUpdateFromSeries: typeof buildUpdateFromSeries !== "undefined" ? buildUpdateFromSeries : null,
  validateUpdate: typeof validateUpdate !== "undefined" ? validateUpdate : null,
  rangeOverWindow: typeof rangeOverWindow !== "undefined" ? rangeOverWindow : null
};
`;
  const moduleObj = { exports: {} };
  const ctx = {
    module: moduleObj, exports: moduleObj.exports, require: (id) => require(id),
    process, console, __dirname: path.join(ROOT, "scripts"), __filename: FETCHER_PATH,
    Buffer, URL, fetch: () => { throw new Error("no fetch in test"); }, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  new vm.Script(src, { filename: FETCHER_PATH }).runInContext(ctx);
  return moduleObj.exports;
}

// Build a synthetic monthly "level" series of N months ending at endYM.
// Values follow a known pattern so we can predict high/low.
function syntheticSeries(n, endYM) {
  const [ey, em] = endYM.split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(ey, em - 1 - i, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    // value oscillates; put a clear max early and min late within the 36 window
    out.push({ date: ym, value: 10 + Math.sin(i / 3) * 5 });
  }
  return out;
}

function main() {
  console.log("[history-36mo] Testing 36-month window + enriched compared_to\n");
  const f = loadFetcherInternals();
  check("extracted buildUpdateFromSeries", typeof f.buildUpdateFromSeries === "function");
  check("extracted validateUpdate", typeof f.validateUpdate === "function");
  check("extracted rangeOverWindow", typeof f.rangeOverWindow === "function");

  const config = { valueFormat: "number_1", compareMode: "points" };

  // --- 40-month series -> 36-point window ---------------------------------
  console.log("\n40-month series:");
  const series40 = syntheticSeries(40, "2026-05");
  const u = f.buildUpdateFromSeries("mfg-activity", config, series40);
  check("data_points length is 36", u.data_points.length === 36, `len=${u.data_points.length}`);
  check("data_points_window_months === 36", u.data_points_window_months === 36, `=${u.data_points_window_months}`);
  check("compared_to has vs_1mo", !!u.compared_to.vs_1mo);
  check("compared_to has vs_6mo", !!u.compared_to.vs_6mo);
  check("compared_to has vs_12mo", !!u.compared_to.vs_12mo);
  check("compared_to has vs_36mo", !!u.compared_to.vs_36mo);
  check("compared_to has vs_pre_2020", !!u.compared_to.vs_pre_2020);
  const r = u.compared_to.range_36mo;
  check("range_36mo present with numeric high/low", r && typeof r.high === "number" && typeof r.low === "number", JSON.stringify(r));
  check("range_36mo high >= low", r && r.high >= r.low, JSON.stringify(r));
  // Independently compute expected high/low over the trailing 36 months.
  const last36 = series40.slice(-36);
  const expHi = Math.round(Math.max(...last36.map((x) => x.value)) * 10) / 10;
  const expLo = Math.round(Math.min(...last36.map((x) => x.value)) * 10) / 10;
  check("range_36mo.high matches window max", r.high === expHi, `got=${r.high} exp=${expHi}`);
  check("range_36mo.low matches window min", r.low === expLo, `got=${r.low} exp=${expLo}`);
  check("range_36mo.high_date inside window", last36.some((x) => x.date === r.high_date), `high_date=${r.high_date}`);
  check("range_36mo.low_date inside window", last36.some((x) => x.date === r.low_date), `low_date=${r.low_date}`);
  // validateUpdate must accept it.
  let okValidate = true;
  try { f.validateUpdate("mfg-activity", u); } catch (e) { okValidate = false; check("validateUpdate accepts enriched 36mo update", false, e.message); }
  if (okValidate) check("validateUpdate accepts enriched 36mo update", true);

  // --- 15-month young series -> <36 points, honest window -----------------
  console.log("\n15-month (young) series:");
  const series15 = syntheticSeries(15, "2026-05");
  const u2 = f.buildUpdateFromSeries("services-activity", config, series15);
  check("data_points length is 15 (no fabrication)", u2.data_points.length === 15, `len=${u2.data_points.length}`);
  check("data_points_window_months === 15", u2.data_points_window_months === 15, `=${u2.data_points_window_months}`);
  check("range_36mo window_months <= 15", u2.compared_to.range_36mo.window_months <= 15, `=${u2.compared_to.range_36mo.window_months}`);
  // vs_36mo will be 'flat' (no data 36 months back) — compare() returns a flat object, still truthy.
  check("vs_36mo is still a well-formed object", !!u2.compared_to.vs_36mo && "direction" in u2.compared_to.vs_36mo, JSON.stringify(u2.compared_to.vs_36mo));
  let okValidate2 = true;
  try { f.validateUpdate("services-activity", u2); } catch (e) { okValidate2 = false; check("validateUpdate accepts young-series update", false, e.message); }
  if (okValidate2) check("validateUpdate accepts young-series update", true);

  console.log("");
  if (failures > 0) { console.error(`[history-36mo] FAIL: ${failures} assertion(s).`); process.exit(1); }
  console.log("[history-36mo] PASS: 36-month window + enriched compared_to are correct and honest.");
}

main();
