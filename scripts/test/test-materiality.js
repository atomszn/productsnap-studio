#!/usr/bin/env node
/* =============================================================================
   test-materiality.js — regression suite for the editorial-materiality
   classifier (scripts/lib/materiality.js) + the editorial-runner
   --classify-materiality subcommand (tier-3 exception routing).

   Covers (per exception_routing_spec.md DELIVERABLE 3):
     - material_data_move ABOVE threshold  -> is_material/any_material true
     - material_data_move BELOW threshold  -> is_material false
     - narrative_review_required / editorial_stale ONLY (no move)
           -> has_material_move false, narrative_or_staleness_only true
     - threshold-basis paths: registry.exception_threshold | derived_fraction
           | derived_fraction(pct) | default (no basis)
     - KEEP decision -> has_material_move false, any_material false,
           narrative_or_staleness_only false
     - classifier mutates NOTHING (deep-frozen inputs -> no throw, no change)
     - subcommand exit codes 0 / 3 / 2 via tiny fixtures

   Dependency-free, offline. Exit 0 = all assertions pass.
   ===========================================================================*/
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const { classifyMateriality } = require(path.join(ROOT, "scripts", "lib", "materiality.js"));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ---- registry fixtures (only the fields the classifier reads) --------------
function registry() {
  return {
    signals: [
      // value-space, explicit exception_threshold present
      { signal_id: "cpi-headline", thresholds: { max_abs_step: 2.5, max_pct_step: 200, exception_threshold: 0.3 } },
      // value-space, no explicit field -> derived_fraction of max_abs_step
      { signal_id: "mfg-activity", thresholds: { max_abs_step: 25, max_pct_step: 200, centered_zero: true } },
      // pct-only (no max_abs_step) -> derived_fraction(pct) from max_pct_step
      { signal_id: "fed-net-liquidity", thresholds: { max_abs_step: null, max_pct_step: 8 } },
      // no usable threshold basis at all -> default / not material
      { signal_id: "emerging-apps", thresholds: { max_abs_step: null, max_pct_step: null } }
    ]
  };
}

function moveDecision(signals) {
  return {
    decision: "DRAFT",
    triggers: [{ type: "material_data_move", detail: "moved", signals }]
  };
}

// ---- DELIVERABLE 1: classifier core ---------------------------------------
function testCore() {
  const reg = registry();

  console.log("A) explicit registry.exception_threshold path (cpi, threshold 0.3):");
  // ABOVE: 3.81 -> 4.30 = +0.49 >= 0.3 -> material
  let r = classifyMateriality(moveDecision([{ id: "cpi-headline", from: 3.81, to: 4.30, delta: 0.49 }]), reg);
  check("has_material_move true", r.has_material_move === true);
  check("basis is registry.exception_threshold", r.material_signals[0].threshold_basis === "registry.exception_threshold",
    r.material_signals[0].threshold_basis);
  check("threshold resolved to 0.3", r.material_signals[0].exception_threshold === 0.3);
  check("ABOVE -> is_material true", r.material_signals[0].is_material === true);
  check("ABOVE -> any_material true", r.any_material === true);
  check("not narrative_or_staleness_only (a move exists)", r.narrative_or_staleness_only === false);

  // BELOW: 3.81 -> 3.90 = +0.09 < 0.3 -> not material
  r = classifyMateriality(moveDecision([{ id: "cpi-headline", from: 3.81, to: 3.90, delta: 0.09 }]), reg);
  check("BELOW -> is_material false", r.material_signals[0].is_material === false);
  check("BELOW -> any_material false", r.any_material === false);
  check("BELOW still has_material_move true (a move trigger was present)", r.has_material_move === true);

  console.log("\nB) derived_fraction path (mfg-activity, max_abs_step 25, frac 0.35 -> 8.75):");
  // ABOVE: -0.4 -> 10.3 = 10.7 >= 8.75 -> material
  r = classifyMateriality(moveDecision([{ id: "mfg-activity", from: -0.4, to: 10.3, delta: 10.7 }]), reg);
  check("basis derived_fraction", r.material_signals[0].threshold_basis === "derived_fraction", r.material_signals[0].threshold_basis);
  check("threshold == 0.35*25 = 8.75", Math.abs(r.material_signals[0].exception_threshold - 8.75) < 1e-9,
    String(r.material_signals[0].exception_threshold));
  check("ABOVE -> is_material true", r.material_signals[0].is_material === true);
  // BELOW: 1.0 -> 5.0 = 4.0 < 8.75 -> not material
  r = classifyMateriality(moveDecision([{ id: "mfg-activity", from: 1.0, to: 5.0, delta: 4.0 }]), reg);
  check("BELOW -> is_material false", r.material_signals[0].is_material === false);

  console.log("\nC) derived_fraction(pct) path (fed-net-liquidity, max_pct_step 8, frac 0.35 -> 2.8%):");
  // 6.7 -> 7.0 = +0.3; 0.3/6.7*100 = 4.477% >= 2.8% -> material
  r = classifyMateriality(moveDecision([{ id: "fed-net-liquidity", from: 6.7, to: 7.0, delta: 0.3 }]), reg);
  check("basis derived_fraction(pct)", r.material_signals[0].threshold_basis === "derived_fraction(pct)", r.material_signals[0].threshold_basis);
  check("ABOVE pct -> is_material true", r.material_signals[0].is_material === true, r.material_signals[0].reason);
  // 6.7 -> 6.75 = +0.05; 0.05/6.7*100 = 0.746% < 2.8% -> not material
  r = classifyMateriality(moveDecision([{ id: "fed-net-liquidity", from: 6.7, to: 6.75, delta: 0.05 }]), reg);
  check("BELOW pct -> is_material false", r.material_signals[0].is_material === false, r.material_signals[0].reason);

  console.log("\nD) no-basis path (emerging-apps, no abs/pct step):");
  r = classifyMateriality(moveDecision([{ id: "emerging-apps", from: 1, to: 9, delta: 8 }]), reg);
  check("basis default", r.material_signals[0].threshold_basis === "default", r.material_signals[0].threshold_basis);
  check("no-basis -> is_material false", r.material_signals[0].is_material === false);
  check("reason no_threshold_basis", r.material_signals[0].reason === "no_threshold_basis", r.material_signals[0].reason);

  console.log("\nE) narrative/staleness-only DRAFT (no material_data_move):");
  r = classifyMateriality({
    decision: "DRAFT",
    triggers: [
      { type: "narrative_review_required", detail: "wc flagged" },
      { type: "editorial_stale", detail: "aged" }
    ]
  }, reg);
  check("has_material_move false", r.has_material_move === false);
  check("any_material false", r.any_material === false);
  check("narrative_or_staleness_only true (waits for Friday)", r.narrative_or_staleness_only === true);
  check("material_signals empty", r.material_signals.length === 0);

  console.log("\nF) KEEP decision:");
  r = classifyMateriality({ decision: "KEEP", triggers: [] }, reg);
  check("has_material_move false", r.has_material_move === false);
  check("any_material false", r.any_material === false);
  check("narrative_or_staleness_only false (KEEP never waits)", r.narrative_or_staleness_only === false);

  console.log("\nG) mixed move: one material + one immaterial -> any_material true:");
  r = classifyMateriality(moveDecision([
    { id: "cpi-headline", from: 3.0, to: 3.05, delta: 0.05 },   // below 0.3
    { id: "mfg-activity", from: -0.4, to: 10.3, delta: 10.7 }   // above 8.75
  ]), reg);
  check("any_material true (at least one material)", r.any_material === true);
  check("two scored signals", r.material_signals.length === 2);

  console.log("\nH) derived_fraction override via opts.derived_fraction:");
  // mfg max_abs_step 25; frac 0.1 -> threshold 2.5; a 4.0 move now clears it.
  r = classifyMateriality(moveDecision([{ id: "mfg-activity", from: 1.0, to: 5.0, delta: 4.0 }]), reg, { derived_fraction: 0.1 });
  check("override lowers threshold to 2.5", Math.abs(r.material_signals[0].exception_threshold - 2.5) < 1e-9,
    String(r.material_signals[0].exception_threshold));
  check("4.0 move now material under frac 0.1", r.material_signals[0].is_material === true);

  console.log("\nI) abs_delta derived from to/from when delta omitted:");
  r = classifyMateriality(moveDecision([{ id: "cpi-headline", from: 3.0, to: 3.5 }]), reg); // delta missing
  check("abs_delta computed = 0.5", Math.abs(r.material_signals[0].abs_delta - 0.5) < 1e-9, String(r.material_signals[0].abs_delta));
  check("0.5 >= 0.3 -> material", r.material_signals[0].is_material === true);
}

// ---- classifier mutates NOTHING -------------------------------------------
function deepFreeze(o) {
  if (o && typeof o === "object") {
    Object.keys(o).forEach((k) => deepFreeze(o[k]));
    Object.freeze(o);
  }
  return o;
}
function testNoMutation() {
  console.log("\nJ) classifier mutates nothing (deep-frozen inputs):");
  const dec = deepFreeze(moveDecision([{ id: "cpi-headline", from: 3.81, to: 4.30, delta: 0.49 }]));
  const reg = deepFreeze(registry());
  const before = JSON.stringify(dec) + "||" + JSON.stringify(reg);
  let threw = false;
  try { classifyMateriality(dec, reg); } catch (e) { threw = true; console.log("    threw: " + e.message); }
  const after = JSON.stringify(dec) + "||" + JSON.stringify(reg);
  check("no throw on frozen inputs", threw === false);
  check("inputs unchanged after classify", before === after);
}

// ---- DELIVERABLE 2: subcommand exit codes ---------------------------------
function runSub(dir, extraArgs) {
  // Invoke the COPY of the runner inside `dir` — editorial-runner resolves its
  // data paths off its own __dirname, so it must live in the temp tree to read
  // the fixture data we wrote there (not the real repo's live data).
  const runner = path.join(dir, "automation", "editorial-runner.js");
  const res = spawnSync(process.execPath, [runner, "--classify-materiality"].concat(extraArgs || []),
    { cwd: dir, encoding: "utf8", timeout: 20000,
      env: Object.assign({}, process.env) });
  return res;
}

// The runner reads data/ relative to ITS OWN location (ROOT), so to exercise the
// fixture decisions we write them into a throwaway clone of the data files the
// subcommand reads, then run the runner with cwd set there. The runner resolves
// paths off __dirname though, so instead we run it against temp data by copying
// the runner + its lib deps into a temp tree mirroring the repo layout. Simpler
// and robust: copy the whole minimal set the subcommand touches.
function setupRunnerTree(decision) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-mat-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.mkdirSync(path.join(dir, "automation"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });

  copy(path.join(ROOT, "automation", "editorial-runner.js"), path.join(dir, "automation", "editorial-runner.js"));
  // lib deps required by editorial-runner at load time
  [
    "schema-validate.js", "verify-claims.js", "apply-editorial.js", "clarity-scan.js",
    "no-advice-scan.js", "narrative-consistency.js", "post-publish-check.js", "materiality.js",
    "pulse-trust.js", "pulse-sources.js", "threshold-evidence.js", "threshold-outcomes.js"
  ].forEach((f) => copy(path.join(ROOT, "scripts", "lib", f), path.join(dir, "scripts", "lib", f)));
  copy(path.join(ROOT, "scripts", "check-budget.js"), path.join(dir, "scripts", "check-budget.js"));

  // data the subcommand reads
  fs.writeFileSync(path.join(dir, "data", "signals_registry.json"), JSON.stringify(registry(), null, 2));
  if (decision !== undefined) {
    fs.writeFileSync(path.join(dir, "data", "pulse-editorial-decision.json"), JSON.stringify(decision, null, 2));
  }
  return dir;
}
function copy(src, dst) { if (fs.existsSync(src)) fs.copyFileSync(src, dst); }

function testSubcommand() {
  console.log("\nK) subcommand exit codes (0 material / 3 hold / 2 cannot-classify):");

  // 0 = any_material true
  let dir = setupRunnerTree(moveDecision([{ id: "cpi-headline", from: 3.81, to: 4.30, delta: 0.49 }]));
  let res = runSub(dir);
  check("exit 0 when any_material true", res.status === 0, "status=" + res.status + " err=" + (res.stderr || ""));
  let out = safeParse(res.stdout);
  check("stdout JSON any_material true", out && out.any_material === true);
  cleanup(dir);

  // 3 = any_material false (narrative/staleness-only)
  dir = setupRunnerTree({ decision: "DRAFT", triggers: [{ type: "editorial_stale", detail: "aged" }] });
  res = runSub(dir);
  check("exit 3 when no material move (hold for Friday)", res.status === 3, "status=" + res.status);
  out = safeParse(res.stdout);
  check("stdout JSON narrative_or_staleness_only true", out && out.narrative_or_staleness_only === true);
  cleanup(dir);

  // 3 also for material move BELOW threshold
  dir = setupRunnerTree(moveDecision([{ id: "cpi-headline", from: 3.81, to: 3.90, delta: 0.09 }]));
  res = runSub(dir);
  check("exit 3 when move is below threshold", res.status === 3, "status=" + res.status);
  cleanup(dir);

  // 2 = cannot classify (no decision file)
  dir = setupRunnerTree(undefined); // no decision written
  res = runSub(dir);
  check("exit 2 when decision missing", res.status === 2, "status=" + res.status);
  cleanup(dir);

  // 0 with --derived-fraction override making a sub-threshold move material
  dir = setupRunnerTree(moveDecision([{ id: "mfg-activity", from: 1.0, to: 5.0, delta: 4.0 }]));
  res = runSub(dir, ["--derived-fraction", "0.1"]); // threshold 2.5 -> 4.0 clears
  check("exit 0 with lowered --derived-fraction", res.status === 0, "status=" + res.status);
  cleanup(dir);
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }

function main() {
  console.log("[materiality] classifier + exception-routing regression\n");
  testCore();
  testNoMutation();
  testSubcommand();
  console.log("");
  if (failures > 0) {
    console.error(`[materiality] FAIL: ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("[materiality] PASS: materiality classification + exit codes correct.");
}

main();
