#!/usr/bin/env node
/* ========================================================================
   Regression test for the Track 2 editorial-preservation guard fix.

   BUG (CI run #22, post-merge of PR #31): the fetcher writes the optional
   data field `data_points_window_months` on automated signals. That field is
   explicitly ALLOWED by applyAllowedUpdate (via OPTIONAL_DATA_FIELDS), but
   stripMutableData() only stripped MUTABLE_DATA_FIELDS before the
   editorial-preservation comparison. So on the first real refresh the new
   field was present in `after` but absent from `before`, and the guard
   wrongly threw "Editorial-preservation guard failed: a non-data field
   changed" — failing the whole pipeline before it could commit.

   FIX: stripMutableData() also deletes OPTIONAL_DATA_FIELDS, mirroring what
   applyAllowedUpdate already permits.

   This test proves BOTH halves so the guard stays honest:
     1) Writing/adding an OPTIONAL_DATA_FIELD (data_points_window_months) on an
        automated signal must PASS the guard.
     2) A genuine editorial change (e.g. a signal title) must STILL FAIL the
        guard. (The fix must not weaken protection of real editorial content.)

   Dependency-free, offline (no fetch). Run:
     node scripts/test/test-editorial-guard-optional-fields.js
   Exit 0 = fix correct and guard still protective. Exit 1 = regression.
   ======================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const FETCHER_PATH = path.join(ROOT, "scripts", "fetch-pulse-data.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures += 1;
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

// Same proven loader used by test-pulse-sources-consistency.js: load the
// fetcher source, neutralize its trailing main().catch(...) invocation so
// require() doesn't kick off a live fetch, and export the internals we test.
function loadFetcherInternals() {
  let src = fs.readFileSync(FETCHER_PATH, "utf8");
  const idx = src.indexOf("main().catch(");
  if (idx !== -1) {
    src = src.slice(0, idx) + "/* main() disabled for guard test */\n";
  } else {
    src = src.replace(/^\s*main\(\)\s*;?\s*$/m, "/* main() disabled for guard test */");
  }
  src += `
;module.exports = {
  stripMutableData: typeof stripMutableData !== "undefined" ? stripMutableData : null,
  assertEditorialPreserved: typeof assertEditorialPreserved !== "undefined" ? assertEditorialPreserved : null,
  OPTIONAL_DATA_FIELDS: typeof OPTIONAL_DATA_FIELDS !== "undefined" ? OPTIONAL_DATA_FIELDS : null,
  AUTO_SIGNAL_IDS: typeof AUTO_SIGNAL_IDS !== "undefined" ? AUTO_SIGNAL_IDS : null
};
`;
  const moduleObj = { exports: {} };
  const ctx = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: (id) => require(id),
    process,
    console,
    __dirname: path.join(ROOT, "scripts"),
    __filename: FETCHER_PATH,
    Buffer,
    URL,
    fetch: () => { throw new Error("fetch disabled in guard test"); },
    setTimeout,
    clearTimeout
  };
  vm.createContext(ctx);
  new vm.Script(src, { filename: FETCHER_PATH }).runInContext(ctx);
  return moduleObj.exports;
}

// Minimal Pulse-shaped document with one automated signal. The signal id must
// be a real automated id so stripMutableData (which only acts on
// AUTO_SIGNAL_IDS) processes it.
function baseDoc(autoId) {
  return {
    phase_meta: { last_pipeline_refresh: "2026-06-09T00:00:00Z", phase: 1, shadow_mode: true },
    signals: [
      {
        id: autoId,
        title: "Consumer Prices (CPI)",
        current_value: "3.81%",
        last_updated: "2026-04-01",
        data_points: [{ date: "2026-03", value: 3.7 }, { date: "2026-04", value: 3.81 }],
        compared_to: { vs_1mo: {}, vs_6mo: {}, vs_12mo: {}, vs_36mo: {}, vs_pre_2020: {}, range_36mo: { high: 4, low: 3 } },
        percentile: { value: 62 },
        timestamps: { latest_source_data_date: "2026-04-01", last_editorial_reviewed: "2026-05-01" }
      }
    ]
  };
}

function main() {
  console.log("[editorial-guard] Track 2 regression: optional data fields must not trip the guard\n");
  const fetcher = loadFetcherInternals();

  check("loader exposed stripMutableData", typeof fetcher.stripMutableData === "function");
  check("loader exposed assertEditorialPreserved", typeof fetcher.assertEditorialPreserved === "function");
  check("OPTIONAL_DATA_FIELDS includes data_points_window_months",
    fetcher.OPTIONAL_DATA_FIELDS && fetcher.OPTIONAL_DATA_FIELDS.has("data_points_window_months"));
  if (failures) { console.error("\n[editorial-guard] FAIL: loader/internals unavailable."); process.exit(1); }

  const autoId = (fetcher.AUTO_SIGNAL_IDS && fetcher.AUTO_SIGNAL_IDS[0]) || "cpi-headline";

  // ---- Case 1: adding an OPTIONAL_DATA_FIELD must PASS the guard ----------
  // `before` predates Track 2 (no data_points_window_months). `after` is the
  // refreshed doc that now carries it — plus the kind of data churn a refresh
  // produces (new current_value / data point). This is exactly the CI #22 shape.
  console.log("\nCase 1 \u2014 new optional data field (data_points_window_months) added by refresh:");
  const before1 = baseDoc(autoId);
  const after1 = baseDoc(autoId);
  after1.signals[0].data_points_window_months = 36;        // the new optional field
  after1.signals[0].current_value = "3.90%";               // normal data churn
  after1.signals[0].data_points.push({ date: "2026-05", value: 3.9 });
  after1.signals[0].last_updated = "2026-05-01";
  let threw1 = null;
  try { fetcher.assertEditorialPreserved(before1, after1); } catch (e) { threw1 = e; }
  check("guard does NOT fire when only data + optional data fields changed",
    threw1 === null, threw1 ? threw1.message : "");

  // ---- Case 2: a genuine editorial change must STILL FAIL the guard ------
  console.log("\nCase 2 \u2014 real editorial change (title edited) must still be caught:");
  const before2 = baseDoc(autoId);
  const after2 = baseDoc(autoId);
  after2.signals[0].data_points_window_months = 36;        // allowed
  after2.signals[0].title = "Inflation, basically";        // NOT allowed (editorial)
  let threw2 = null;
  try { fetcher.assertEditorialPreserved(before2, after2); } catch (e) { threw2 = e; }
  check("guard STILL fires when an editorial field (title) changes",
    threw2 !== null && /non-data field changed/.test(threw2.message),
    threw2 ? threw2.message : "guard did not fire");

  console.log("");
  if (failures > 0) {
    console.error(`[editorial-guard] FAIL: ${failures} problem(s). The guard fix is wrong or weakened.`);
    process.exit(1);
  }
  console.log("[editorial-guard] PASS: optional data fields pass; real editorial edits still hard-fail.");
}

main();
