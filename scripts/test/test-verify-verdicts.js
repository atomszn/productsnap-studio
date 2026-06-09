#!/usr/bin/env node
/* ========================================================================
   Verdict test for scripts/verify-pulse-sources.js.

   We cannot reach FRED/BLS in this sandbox (no keys), so we run the verifier
   against a THROWAWAY working copy of data/ and stub the network by monkey-
   patching the shared lib's fetchPreparedSeries via a tiny shim module that
   the verifier loads. Instead of editing the verifier, we exploit that it
   require()s "./lib/pulse-sources.js": we copy the verifier + a STUB
   pulse-sources into a temp scripts dir and point the stub at canned series.

   Scenarios:
     1) MATCH            stub returns exactly the stored value/date
     2) VALUE_DRIFT      stub returns a different but in-range value on a NEWER
                         valid date -> verifier AUTO-CORRECTS content, exit 0
     3) STRUCTURAL_FAIL  stub returns an out-of-range value -> exit 1, content
                         is NOT changed (last-known-good kept)
     4) STRUCTURAL_FAIL  stub returns a FUTURE date -> exit 1, no change

   Exit 0 = all scenarios behaved correctly.
   ======================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// One automated signal under test. Range chosen so we can craft in/out-of-range.
const SIGNAL_ID = "mfg-activity";
const STORED_VALUE = "26.7";
const STORED_DATE = "2026-04-01";

function makeContent() {
  return {
    signals: [
      { id: SIGNAL_ID, current_value: STORED_VALUE, last_updated: STORED_DATE,
        timestamps: { latest_source_data_date: STORED_DATE, last_editorial_reviewed: "2026-06-01" } },
      // a curated signal to confirm SKIP path
      { id: "ai-regulation", current_value: "tracked", last_updated: "2026-05-24" }
    ]
  };
}
function makeRegistry() {
  return { signals: [
    { signal_id: SIGNAL_ID, name: "Mfg", thresholds: { expected_range: [-60, 60] } }
  ] };
}

// A stub pulse-sources module: re-exports the real one but overrides
// fetchPreparedSeries/deriveCurrent to return a canned source observation.
function stubSource(dir, cannedDerive) {
  const stub = `
"use strict";
const real = require(${JSON.stringify(path.join(ROOT, "scripts", "lib", "pulse-sources.js"))});
module.exports = Object.assign({}, real, {
  AUTO_SIGNAL_IDS: [${JSON.stringify(SIGNAL_ID)}],
  SIGNAL_CONFIG: { ${JSON.stringify(SIGNAL_ID)}: { provider: "fred", seriesId: "GACDFSA066MSFRBPHI", transform: "level_monthly_last", valueFormat: "number_1", compareMode: "points" } },
  fetchPreparedSeries: async function () { return { prepared: [{ date: "2099-01", value: 0 }], rawLatest: null }; },
  deriveCurrent: function () { return ${JSON.stringify(cannedDerive)}; }
});
`;
  fs.writeFileSync(path.join(dir, "scripts", "lib", "pulse-sources.js"), stub);
}

function setupDir(cannedDerive) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-verify-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "verify-pulse-sources.js"), path.join(dir, "scripts", "verify-pulse-sources.js"));
  stubSource(dir, cannedDerive);
  fs.writeFileSync(path.join(dir, "data", "pulse-content.json"), JSON.stringify(makeContent(), null, 2));
  fs.writeFileSync(path.join(dir, "data", "signals_registry.json"), JSON.stringify(makeRegistry(), null, 2));
  return dir;
}

function runVerify(dir, args) {
  // FRED key present so requireEnv doesn't trip (the stub ignores it anyway).
  const res = spawnSync(process.execPath, [path.join(dir, "scripts", "verify-pulse-sources.js"), ...(args || [])],
    { cwd: dir, encoding: "utf8", timeout: 20000, env: Object.assign({}, process.env, { FRED_API_KEY: "stub", BLS_API_KEY: "stub" }) });
  const content = JSON.parse(fs.readFileSync(path.join(dir, "data", "pulse-content.json"), "utf8"));
  let verify = null;
  try { verify = JSON.parse(fs.readFileSync(path.join(dir, "data", "pulse-source-verification.json"), "utf8")); } catch (e) {}
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, content, verify };
}

function signalValue(content) {
  return content.signals.find((s) => s.id === SIGNAL_ID);
}

function main() {
  console.log("[verify-verdicts] Testing MATCH / VALUE_DRIFT / STRUCTURAL_FAIL\n");

  // 1) MATCH ---------------------------------------------------------------
  console.log("1) MATCH (source == stored):");
  let dir = setupDir({ current_value: "26.7", last_updated: "2026-04-01" });
  let r = runVerify(dir);
  check("exit 0", r.status === 0, `status=${r.status}`);
  check("verdict MATCH", r.verify && r.verify.signals.find((s) => s.id === SIGNAL_ID).verdict === "MATCH");
  check("stored value unchanged", signalValue(r.content).current_value === "26.7");
  check("curated signal SKIP", r.verify.signals.find((s) => s.id === "ai-regulation").verdict === "SKIP");
  fs.rmSync(dir, { recursive: true, force: true });

  // 2) VALUE_DRIFT -> auto-correct ----------------------------------------
  console.log("\n2) VALUE_DRIFT (clean, in-range, newer date -> auto-correct):");
  dir = setupDir({ current_value: "-0.4", last_updated: "2026-05-01" });
  r = runVerify(dir);
  check("exit 0 (clean drift is not a failure)", r.status === 0, `status=${r.status}`);
  check("verdict VALUE_DRIFT", r.verify.signals.find((s) => s.id === SIGNAL_ID).verdict === "VALUE_DRIFT");
  check("content auto-corrected to -0.4", signalValue(r.content).current_value === "-0.4", `got=${signalValue(r.content).current_value}`);
  check("last_updated auto-corrected to 2026-05-01", signalValue(r.content).last_updated === "2026-05-01", `got=${signalValue(r.content).last_updated}`);
  fs.rmSync(dir, { recursive: true, force: true });

  // 2b) VALUE_DRIFT in --check mode must NOT mutate -------------------------
  console.log("\n2b) VALUE_DRIFT in --check (read-only -> no mutation):");
  dir = setupDir({ current_value: "-0.4", last_updated: "2026-05-01" });
  r = runVerify(dir, ["--check"]);
  check("exit 0", r.status === 0, `status=${r.status}`);
  check("content NOT changed in --check", signalValue(r.content).current_value === "26.7", `got=${signalValue(r.content).current_value}`);
  fs.rmSync(dir, { recursive: true, force: true });

  // 3) STRUCTURAL_FAIL: out-of-range --------------------------------------
  console.log("\n3) STRUCTURAL_FAIL (out-of-range value -> hard fail, keep last-known-good):");
  dir = setupDir({ current_value: "999", last_updated: "2026-05-01" });
  r = runVerify(dir);
  check("exit 1", r.status === 1, `status=${r.status}`);
  check("verdict STRUCTURAL_FAIL", r.verify.signals.find((s) => s.id === SIGNAL_ID).verdict === "STRUCTURAL_FAIL");
  check("content NOT changed (last-known-good kept)", signalValue(r.content).current_value === "26.7", `got=${signalValue(r.content).current_value}`);
  fs.rmSync(dir, { recursive: true, force: true });

  // 4) STRUCTURAL_FAIL: future date ---------------------------------------
  console.log("\n4) STRUCTURAL_FAIL (future observation date -> hard fail):");
  dir = setupDir({ current_value: "5.0", last_updated: "2099-12-01" });
  r = runVerify(dir);
  check("exit 1", r.status === 1, `status=${r.status}`);
  check("verdict STRUCTURAL_FAIL", r.verify.signals.find((s) => s.id === SIGNAL_ID).verdict === "STRUCTURAL_FAIL");
  check("content NOT changed", signalValue(r.content).current_value === "26.7");
  fs.rmSync(dir, { recursive: true, force: true });

  // 5) STRUCTURAL_FAIL: backwards date ------------------------------------
  console.log("\n5) STRUCTURAL_FAIL (source date older than stored -> hard fail):");
  dir = setupDir({ current_value: "10.0", last_updated: "2026-01-01" });
  r = runVerify(dir);
  check("exit 1", r.status === 1, `status=${r.status}`);
  check("verdict STRUCTURAL_FAIL (backwards date)", r.verify.signals.find((s) => s.id === SIGNAL_ID).verdict === "STRUCTURAL_FAIL");
  check("content NOT changed", signalValue(r.content).current_value === "26.7");
  fs.rmSync(dir, { recursive: true, force: true });

  console.log("");
  if (failures > 0) { console.error(`[verify-verdicts] FAIL: ${failures} assertion(s).`); process.exit(1); }
  console.log("[verify-verdicts] PASS: auto-correct on clean drift, hard-fail on garbage, no mutation in --check.");
}

main();
