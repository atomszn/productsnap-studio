#!/usr/bin/env node
/* ========================================================================
   Consistency guard: scripts/lib/pulse-sources.js MUST agree with
   scripts/fetch-pulse-data.js.

   The verifier (verify-pulse-sources.js) re-derives what each signal's
   current_value SHOULD be using the shared lib. That guarantee is only
   meaningful if the shared lib's per-signal config and transforms are an
   exact mirror of the writer's. This test extracts both code paths and
   asserts they agree on:

     1) SIGNAL_CONFIG: every automated signal's provider/seriesId/transform/
        valueFormat/latestFromRaw/compareMode are identical.
     2) prepareSeries(): identical output for each transform on shared input.
     3) formatCurrentValue(): identical output across formats + edge cases.

   Dependency-free, offline. Run: node scripts/test/test-pulse-sources-consistency.js
   Exit 0 = lib and fetcher agree. Exit 1 = drift detected (fix before merge).
   ======================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const FETCHER_PATH = path.join(ROOT, "scripts", "fetch-pulse-data.js");
const lib = require("../lib/pulse-sources.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ----------------------------------------------------------------------
   The fetcher is a CLI script with no module.exports and a main() that runs
   on require. To extract its SIGNAL_CONFIG, prepareSeries and
   formatCurrentValue WITHOUT running its main(), we load the source, append
   an export shim, and evaluate it in a sandbox where main() is a no-op.
   ---------------------------------------------------------------------- */
function loadFetcherInternals() {
  let src = fs.readFileSync(FETCHER_PATH, "utf8");

  // Neutralize the trailing `main().catch(err => { ... });` invocation so that
  // requiring the module does not kick off a live fetch. We only want its pure
  // functions. The block spans from `main().catch(` to the end of file, so we
  // anchor on `main().catch(` and drop everything after it.
  const idx = src.indexOf("main().catch(");
  if (idx !== -1) {
    src = src.slice(0, idx) + "/* main() disabled for consistency test */\n";
  } else {
    // Fallback: a bare main(); call on its own line.
    src = src.replace(/^\s*main\(\)\s*;?\s*$/m, "/* main() disabled for consistency test */");
  }

  // Append an export shim exposing the internals we need to compare.
  src += `
;module.exports = {
  SIGNAL_CONFIG: typeof SIGNAL_CONFIG !== "undefined" ? SIGNAL_CONFIG : null,
  prepareSeries: typeof prepareSeries !== "undefined" ? prepareSeries : null,
  formatCurrentValue: typeof formatCurrentValue !== "undefined" ? formatCurrentValue : null,
  AUTO_SIGNAL_IDS: typeof AUTO_SIGNAL_IDS !== "undefined" ? AUTO_SIGNAL_IDS : null
};
`;

  const moduleObj = { exports: {} };
  const sandboxRequire = (id) => require(id);
  const ctx = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: sandboxRequire,
    process,
    console,
    __dirname: path.join(ROOT, "scripts"),
    __filename: FETCHER_PATH,
    Buffer,
    URL,
    fetch: () => { throw new Error("fetch disabled in consistency test"); },
    setTimeout,
    clearTimeout
  };
  vm.createContext(ctx);
  const script = new vm.Script(src, { filename: FETCHER_PATH });
  script.runInContext(ctx);
  return moduleObj.exports;
}

function main() {
  console.log("[consistency] Comparing scripts/lib/pulse-sources.js against scripts/fetch-pulse-data.js\n");

  const fetcher = loadFetcherInternals();

  // --- 1) SIGNAL_CONFIG parity --------------------------------------------
  console.log("SIGNAL_CONFIG parity:");
  const libIds = lib.AUTO_SIGNAL_IDS.slice().sort();
  const fetcherIds = Object.keys(fetcher.SIGNAL_CONFIG || {}).sort();
  check("same set of automated signal ids", JSON.stringify(libIds) === JSON.stringify(fetcherIds),
    `lib=${JSON.stringify(libIds)} fetcher=${JSON.stringify(fetcherIds)}`);

  const FIELDS = ["provider", "seriesId", "transform", "valueFormat", "compareMode", "latestFromRaw", "cadence"];
  for (const id of libIds) {
    const a = lib.SIGNAL_CONFIG[id] || {};
    const b = (fetcher.SIGNAL_CONFIG || {})[id] || {};
    for (const f of FIELDS) {
      check(`${id}.${f}`, String(a[f]) === String(b[f]), `lib=${a[f]} fetcher=${b[f]}`);
    }
  }

  // --- 2) prepareSeries parity --------------------------------------------
  console.log("\nprepareSeries parity:");
  // Synthetic 14-month index series (enough for index_yoy to emit values).
  const obs = [];
  let base = 300;
  for (let i = 0; i < 26; i += 1) {
    const y = 2024 + Math.floor(i / 12);
    const m = String((i % 12) + 1).padStart(2, "0");
    base += 1.5;
    obs.push({ date: `${y}-${m}`, value: Math.round(base * 100) / 100 });
  }
  for (const transform of ["level_monthly_last", "index_yoy", "monthly_change"]) {
    const la = lib.prepareSeries(obs, transform);
    const fb = fetcher.prepareSeries(obs, transform);
    check(`prepareSeries(${transform})`, JSON.stringify(la) === JSON.stringify(fb),
      `lib len=${la.length} fetcher len=${fb.length}`);
  }

  // --- 3) formatCurrentValue parity ---------------------------------------
  console.log("\nformatCurrentValue parity:");
  const cases = [
    ["percent", 3.214],
    ["percent", -0.4],
    ["trillions", 6650000],
    ["jobs_k", 139],
    ["jobs_k", -22],
    ["jobs_k", 0],
    ["number_1", 26.74],
    ["number_1", -0.4],
    ["unknown_format", 12.34]
  ];
  for (const [fmt, val] of cases) {
    const la = lib.formatCurrentValue(val, fmt);
    const fb = fetcher.formatCurrentValue(val, fmt);
    check(`formatCurrentValue(${val}, ${fmt}) => ${la}`, la === fb, `lib=${la} fetcher=${fb}`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`[consistency] FAIL: ${failures} mismatch(es). The shared lib has drifted from the fetcher — reconcile before merge.`);
    process.exit(1);
  }
  console.log("[consistency] PASS: shared lib is an exact mirror of the fetcher's config + transforms.");
}

main();
