#!/usr/bin/env node
/* =============================================================================
   test-threshold-tune.js — regression suite for Phase B of the
   threshold-evolution loop (the deterministic prep + gate around the AI
   recommender/validator contracts):
     - editorial-runner --threshold-tune-prep   (eligibility: min events,
           FP/missed bands, cooldown; exit 3 "nothing to tune" when none qualify)
     - editorial-runner --threshold-recommend-ingest / --threshold-validate-ingest
           (schema gating; exit 2 invalid)
     - editorial-runner --threshold-tune-gate    (clamp to 15% step, floor/ceiling,
           cooldown drop, validator-confidence gating, would_cause_missed_signal
           veto; auto_apply OFF => action=propose and NO registry write on main;
           auto_apply ON + high conf => action=auto_apply into a TEMP registry copy;
           change-log append correctness)

   Everything runs in a throwaway repo tree; the real registry/ledger/change-log
   are NEVER mutated. Dependency-free, offline. Exit 0 = all assertions pass.
   ===========================================================================*/
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const evidence = require(path.join(ROOT, "scripts", "lib", "threshold-evidence.js"));
const { classifyMateriality } = require(path.join(ROOT, "scripts", "lib", "materiality.js"));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// mfg-activity: derived threshold 0.35*25 = 8.75 (no explicit field).
// cpi-headline: explicit exception_threshold 0.3.
function registry() {
  return {
    schema_version: "test",
    signals: [
      { signal_id: "cpi-headline", thresholds: { max_abs_step: 2.5, max_pct_step: 200, exception_threshold: 0.3 } },
      { signal_id: "mfg-activity", thresholds: { max_abs_step: 25, max_pct_step: 200 } }
    ]
  };
}
function moveDecision(signals, extra) {
  return Object.assign({
    generated_at: "2026-05-02T12:00:00.000Z",
    decision: "DRAFT",
    triggers: [{ type: "material_data_move", detail: "moved", signals }]
  }, extra || {});
}
function mkRecord(reg, signals, exit, extra) {
  const dec = moveDecision(signals, extra);
  return evidence.buildEvidenceRecord({
    decision: dec, registry: reg, classification: classifyMateriality(dec, reg),
    routing_outcome: { exit_code: exit }, dow: 2
  });
}

// ---- temp repo tree ----
function copy(src, dst) { if (fs.existsSync(src)) fs.copyFileSync(src, dst); }
function setupTree(opts) {
  opts = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-tt-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.mkdirSync(path.join(dir, "automation", "schemas"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });

  copy(path.join(ROOT, "automation", "editorial-runner.js"), path.join(dir, "automation", "editorial-runner.js"));
  copy(path.join(ROOT, "automation", "model-registry.json"), path.join(dir, "automation", "model-registry.json"));
  copy(path.join(ROOT, "automation", "spend-ledger.json"), path.join(dir, "automation", "spend-ledger.json"));
  [
    "schema-validate.js", "verify-claims.js", "apply-editorial.js", "clarity-scan.js",
    "no-advice-scan.js", "narrative-consistency.js", "post-publish-check.js", "materiality.js",
    "pulse-trust.js", "pulse-sources.js", "threshold-evidence.js", "threshold-outcomes.js"
  ].forEach((f) => copy(path.join(ROOT, "scripts", "lib", f), path.join(dir, "scripts", "lib", f)));
  copy(path.join(ROOT, "scripts", "check-budget.js"), path.join(dir, "scripts", "check-budget.js"));
  ["threshold-evidence.schema.json", "threshold-recommendation.schema.json", "threshold-validation.schema.json"]
    .forEach((f) => copy(path.join(ROOT, "automation", "schemas", f), path.join(dir, "automation", "schemas", f)));

  // config: start from the real one, then apply overrides (e.g. auto_apply).
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "automation", "automation-config.json"), "utf8"));
  if (opts.configPatch) Object.assign(cfg.threshold_autotune, opts.configPatch);
  fs.writeFileSync(path.join(dir, "automation", "automation-config.json"), JSON.stringify(cfg, null, 2));

  fs.writeFileSync(path.join(dir, "data", "signals_registry.json"), JSON.stringify(registry(), null, 2));
  if (opts.ledger) {
    fs.writeFileSync(path.join(dir, "automation", "threshold-evidence.jsonl"),
      opts.ledger.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  if (opts.changeLog) {
    fs.writeFileSync(path.join(dir, "automation", "threshold-change-log.jsonl"),
      opts.changeLog.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return dir;
}
function run(dir, args) {
  return spawnSync(process.execPath, [path.join(dir, "automation", "editorial-runner.js")].concat(args),
    { cwd: dir, encoding: "utf8", timeout: 30000, env: Object.assign({}, process.env) });
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

// Build a ledger where mfg-activity is seen >=8 times with a notable missed rate
// (held near-miss moves below 8.75 + later recurrence as material).
function eligibleLedger() {
  const reg = registry();
  const recs = [];
  // 3 held near-miss moves (abs_delta 8.0 in [7.4375, 8.75)) => missed candidates
  for (let i = 0; i < 3; i++) recs.push(mkRecord(reg, [{ id: "mfg-activity", from: 0, to: 8.0, delta: 8.0 }], 3));
  // 1 later material move => provides recurrence + a real fire
  recs.push(mkRecord(reg, [{ id: "mfg-activity", from: 0, to: 12.0, delta: 12.0 }], 0));
  // pad to >=8 total appearances with far-below held moves (not candidates)
  for (let i = 0; i < 5; i++) recs.push(mkRecord(reg, [{ id: "mfg-activity", from: 0, to: 1.0, delta: 1.0 }], 3));
  return recs;
}

// ===========================================================================
// A) analyzer eligibility: insufficient evidence => exit 3
// ===========================================================================
function testPrepInsufficient() {
  console.log("A) --threshold-tune-prep insufficient evidence => exit 3:");
  const reg = registry();
  const ledger = [mkRecord(reg, [{ id: "mfg-activity", from: 0, to: 8.0, delta: 8.0 }], 3)];
  const dir = setupTree({ ledger });
  const res = run(dir, ["--threshold-tune-prep"]);
  check("exit 3 (nothing to tune)", res.status === 3, "status=" + res.status);
  const prep = safeParse(res.stdout);
  check("no eligible signals", prep && prep.eligible_signals.length === 0);
  check("mfg considered but ineligible (insufficient_evidence)",
    prep && prep.considered_signals.some((s) => s.signal_id === "mfg-activity" &&
      s.ineligible_reasons.some((r) => r.indexOf("insufficient_evidence") !== -1)));
  cleanup(dir);
}

// ===========================================================================
// B) analyzer eligibility: enough evidence + notable pattern => exit 0
// ===========================================================================
function testPrepEligible() {
  console.log("\nB) --threshold-tune-prep eligible signal => exit 0:");
  const dir = setupTree({ ledger: eligibleLedger() });
  const res = run(dir, ["--threshold-tune-prep"]);
  check("exit 0 (>=1 eligible)", res.status === 0, "status=" + res.status + " err=" + (res.stderr || ""));
  const prep = safeParse(res.stdout);
  check("mfg eligible", prep && prep.eligible_signals.some((s) => s.signal_id === "mfg-activity"),
    prep && JSON.stringify(prep.eligible_signals));
  const mfg = prep && prep.eligible_signals.find((s) => s.signal_id === "mfg-activity");
  check("bounds.ceiling tied to max_abs_step (25)", mfg && mfg.bounds.ceiling === 25, mfg && JSON.stringify(mfg.bounds));
  check("bounds.floor > 0", mfg && mfg.bounds.floor > 0);
  check("recommender_model resolved", prep && typeof prep.recommender_model === "string");
  check("validator_model resolved", prep && typeof prep.validator_model === "string");
  cleanup(dir);
}

// ===========================================================================
// C) analyzer cooldown: recent change blocks eligibility
// ===========================================================================
function testPrepCooldown() {
  console.log("\nC) --threshold-tune-prep cooldown blocks eligibility:");
  const recentChange = [{
    schema_version: "1.0.0", timestamp: new Date().toISOString(), signal_id: "mfg-activity",
    before: 8.75, after: 9.0, basis: "threshold_autotune", disposition: "applied"
  }];
  const dir = setupTree({ ledger: eligibleLedger(), changeLog: recentChange });
  const res = run(dir, ["--threshold-tune-prep"]);
  check("exit 3 (cooldown blocks the only candidate)", res.status === 3, "status=" + res.status);
  const prep = safeParse(res.stdout);
  check("mfg ineligible due to cooldown",
    prep && prep.considered_signals.some((s) => s.signal_id === "mfg-activity" &&
      s.ineligible_reasons.some((r) => r.indexOf("in_cooldown") !== -1)));
  cleanup(dir);
}

// ===========================================================================
// D) ingest schema gating
// ===========================================================================
function writeRec(dir, recs, model) {
  const p = path.join(dir, "rec.json");
  fs.writeFileSync(p, JSON.stringify({
    schema_version: "1.0.0", generated_at: new Date().toISOString(),
    model_used: model || "gpt_5_5", recommendations: recs
  }, null, 2));
  return p;
}
function writeVal(dir, vals, model) {
  const p = path.join(dir, "val.json");
  fs.writeFileSync(p, JSON.stringify({
    schema_version: "1.0.0", generated_at: new Date().toISOString(),
    model_used: model || "gemini_3_1_pro", validations: vals
  }, null, 2));
  return p;
}
function goodRec() {
  return {
    signal_id: "mfg-activity", current_threshold: 8.75, proposed_threshold: 9.5,
    relative_change: 0.0857, rationale: "Held near-misses recurred as material; raise modestly.",
    evidence_refs: ["2026-05-02T12:00:00.000Z"], predicted_effect: "Suppresses noise; keeps the +12 move."
  };
}
function goodVal(overrides) {
  return Object.assign({
    signal_id: "mfg-activity", verdict: "support", confidence: 0.95,
    reasoning: "Evidence supports a modest raise; the real move still clears.",
    would_cause_missed_signal: false
  }, overrides || {});
}

function testIngest() {
  console.log("\nD) ingest schema gating:");
  const dir = setupTree({ ledger: eligibleLedger() });

  let res = run(dir, ["--threshold-recommend-ingest", writeRec(dir, [goodRec()])]);
  check("recommend-ingest valid => exit 0", res.status === 0, "status=" + res.status + " err=" + (res.stderr || ""));
  check("stored recommendation file", fs.existsSync(path.join(dir, "data", "pulse-threshold-recommendation.json")));

  // invalid: missing evidence_refs (minItems 1)
  const badRec = goodRec(); delete badRec.evidence_refs;
  res = run(dir, ["--threshold-recommend-ingest", writeRec(dir, [badRec])]);
  check("recommend-ingest invalid => exit 2", res.status === 2, "status=" + res.status);

  res = run(dir, ["--threshold-validate-ingest", writeVal(dir, [goodVal()])]);
  check("validate-ingest valid => exit 0", res.status === 0, "status=" + res.status);

  // invalid: confidence out of range
  res = run(dir, ["--threshold-validate-ingest", writeVal(dir, [goodVal({ confidence: 1.4 })])]);
  check("validate-ingest invalid => exit 2", res.status === 2, "status=" + res.status);
  cleanup(dir);
}

// ===========================================================================
// E) gate: auto_apply OFF => action=propose, NO registry write on main
// ===========================================================================
function testGatePropose() {
  console.log("\nE) gate auto_apply OFF => propose (no registry write on main):");
  const dir = setupTree({ ledger: eligibleLedger() });
  run(dir, ["--threshold-recommend-ingest", writeRec(dir, [goodRec()])]);
  run(dir, ["--threshold-validate-ingest", writeVal(dir, [goodVal()])]);

  const regBefore = fs.readFileSync(path.join(dir, "data", "signals_registry.json"), "utf8");
  const res = run(dir, ["--threshold-tune-gate"]);
  check("exit 0 (actionable)", res.status === 0, "status=" + res.status + " err=" + (res.stderr || ""));

  const report = safeParse(fs.readFileSync(path.join(dir, "data", "pulse-threshold-tune-report.json"), "utf8"));
  const d = report.decisions.find((x) => x.signal_id === "mfg-activity");
  check("action=propose", d && d.action === "propose", d && d.action);
  check("clamped to +15% step (8.75*1.15=10.0625 >= 9.5, so 9.5 kept)", d && Math.abs(d.clamped_threshold - 9.5) < 1e-9, d && String(d.clamped_threshold));

  // registry on main is UNCHANGED (no --registry-out given)
  check("real-tree registry unchanged (no write on main)",
    fs.readFileSync(path.join(dir, "data", "signals_registry.json"), "utf8") === regBefore);

  // change-log appended with disposition=proposed
  const cl = evidence.readLedger(path.join(dir, "automation", "threshold-change-log.jsonl"));
  check("change-log has 1 proposed entry", cl.length === 1 && cl[0].disposition === "proposed", JSON.stringify(cl));
  check("change-log records before/after", cl[0].before === 8.75 && Math.abs(cl[0].after - 9.5) < 1e-9);
  cleanup(dir);
}

// ===========================================================================
// F) gate clamping to 15% step
// ===========================================================================
function testGateClamp() {
  console.log("\nF) gate clamps an over-aggressive proposal to 15%:");
  const dir = setupTree({ ledger: eligibleLedger() });
  // propose a wild +60% jump (8.75 -> 14.0); must clamp to 8.75*1.15 = 10.0625
  const wild = goodRec(); wild.proposed_threshold = 14.0; wild.relative_change = 0.6;
  run(dir, ["--threshold-recommend-ingest", writeRec(dir, [wild])]);
  run(dir, ["--threshold-validate-ingest", writeVal(dir, [goodVal()])]);
  run(dir, ["--threshold-tune-gate"]);
  const report = safeParse(fs.readFileSync(path.join(dir, "data", "pulse-threshold-tune-report.json"), "utf8"));
  const d = report.decisions.find((x) => x.signal_id === "mfg-activity");
  check("clamped to 8.75*1.15 = 10.0625", d && Math.abs(d.clamped_threshold - 10.0625) < 1e-9, d && String(d.clamped_threshold));
  check("gate noted the clamp", d && d.gate_notes.some((n) => n.indexOf("clamped") !== -1));
  check("still actionable after clamp", d && (d.action === "propose" || d.action === "auto_apply"));
  cleanup(dir);
}

// ===========================================================================
// G) gate floor/ceiling enforcement
// ===========================================================================
function testGateCeiling() {
  console.log("\nG) gate enforces ceiling (cannot exceed max_abs_step):");
  // Use cpi-headline (current 0.3, max_abs_step 2.5 => ceiling 2.5).
  // Propose 0.3 -> 0.4 (+33%); clamp to +15% = 0.345 (well under ceiling) — verify
  // ceiling separately with a registry whose ceiling bites.
  const dir = setupTree({ ledger: eligibleLedger() });
  const rec = {
    signal_id: "cpi-headline", current_threshold: 0.3, proposed_threshold: 0.4, relative_change: 0.333,
    rationale: "raise modestly", evidence_refs: ["x"], predicted_effect: "fewer fires"
  };
  run(dir, ["--threshold-recommend-ingest", writeRec(dir, [rec])]);
  run(dir, ["--threshold-validate-ingest", writeVal(dir, [goodVal({ signal_id: "cpi-headline" })])]);
  run(dir, ["--threshold-tune-gate"]);
  const report = safeParse(fs.readFileSync(path.join(dir, "data", "pulse-threshold-tune-report.json"), "utf8"));
  const d = report.decisions.find((x) => x.signal_id === "cpi-headline");
  check("cpi clamped to +15% (0.345)", d && Math.abs(d.clamped_threshold - 0.345) < 1e-9, d && String(d.clamped_threshold));
  check("clamped value within ceiling 2.5", d && d.clamped_threshold <= 2.5);
  check("bounds.ceiling == 2.5", d && d.bounds.ceiling === 2.5, d && JSON.stringify(d.bounds));
  cleanup(dir);
}

// ===========================================================================
// H) validator-confidence gating + would_cause_missed_signal veto + cooldown
// ===========================================================================
function testGateRejections() {
  console.log("\nH) gate rejects on low conf / veto / reject verdict:");

  // low confidence (0.85 < 0.90)
  let dir = setupTree({ ledger: eligibleLedger() });
  run(dir, ["--threshold-recommend-ingest", writeRec(dir, [goodRec()])]);
  run(dir, ["--threshold-validate-ingest", writeVal(dir, [goodVal({ confidence: 0.85 })])]);
  let res = run(dir, ["--threshold-tune-gate"]);
  check("low-confidence => exit 3 (nothing actionable)", res.status === 3, "status=" + res.status);
  let report = safeParse(fs.readFileSync(path.join(dir, "data", "pulse-threshold-tune-report.json"), "utf8"));
  check("action=reject (low conf)", report.decisions[0].action === "reject");
  check("no change-log entry written", !fs.existsSync(path.join(dir, "automation", "threshold-change-log.jsonl")));
  cleanup(dir);

  // would_cause_missed_signal veto (even at high conf)
  dir = setupTree({ ledger: eligibleLedger() });
  run(dir, ["--threshold-recommend-ingest", writeRec(dir, [goodRec()])]);
  run(dir, ["--threshold-validate-ingest", writeVal(dir, [goodVal({ confidence: 0.99, would_cause_missed_signal: true })])]);
  res = run(dir, ["--threshold-tune-gate"]);
  check("missed-signal veto => exit 3", res.status === 3, "status=" + res.status);
  report = safeParse(fs.readFileSync(path.join(dir, "data", "pulse-threshold-tune-report.json"), "utf8"));
  check("veto noted in gate_notes", report.decisions[0].gate_notes.some((n) => n.indexOf("would_cause_missed_signal") !== -1));
  cleanup(dir);

  // verdict=reject
  dir = setupTree({ ledger: eligibleLedger() });
  run(dir, ["--threshold-recommend-ingest", writeRec(dir, [goodRec()])]);
  run(dir, ["--threshold-validate-ingest", writeVal(dir, [goodVal({ verdict: "reject", confidence: 0.99 })])]);
  res = run(dir, ["--threshold-tune-gate"]);
  check("reject verdict => exit 3", res.status === 3, "status=" + res.status);
  cleanup(dir);

  // cooldown drop at the gate
  dir = setupTree({
    ledger: eligibleLedger(),
    changeLog: [{ schema_version: "1.0.0", timestamp: new Date().toISOString(), signal_id: "mfg-activity",
      before: 8.0, after: 8.75, basis: "threshold_autotune", disposition: "applied" }]
  });
  run(dir, ["--threshold-recommend-ingest", writeRec(dir, [goodRec()])]);
  run(dir, ["--threshold-validate-ingest", writeVal(dir, [goodVal()])]);
  res = run(dir, ["--threshold-tune-gate"]);
  check("cooldown => exit 3", res.status === 3, "status=" + res.status);
  report = safeParse(fs.readFileSync(path.join(dir, "data", "pulse-threshold-tune-report.json"), "utf8"));
  check("cooldown noted", report.decisions[0].gate_notes.some((n) => n.indexOf("in_cooldown") !== -1));
  cleanup(dir);
}

// ===========================================================================
// I) DORMANT auto_apply path: ON + high conf => action=auto_apply, into a TEMP
//    registry copy only (never the live registry). Bounded change asserted.
// ===========================================================================
function testGateAutoApplyDormant() {
  console.log("\nI) dormant auto_apply path (temp registry copy, bounded):");
  const dir = setupTree({ ledger: eligibleLedger(), configPatch: { auto_apply: true } });
  run(dir, ["--threshold-recommend-ingest", writeRec(dir, [goodRec()])]);
  // confidence 0.98 >= auto_apply_min_confidence 0.97
  run(dir, ["--threshold-validate-ingest", writeVal(dir, [goodVal({ confidence: 0.98 })])]);

  const regPath = path.join(dir, "data", "signals_registry.json");
  const regBefore = fs.readFileSync(regPath, "utf8");
  const outPath = path.join(dir, "registry-out.json");
  const res = run(dir, ["--threshold-tune-gate", "--registry-out", outPath]);
  check("exit 0 (actionable)", res.status === 0, "status=" + res.status + " err=" + (res.stderr || ""));

  const report = safeParse(fs.readFileSync(path.join(dir, "data", "pulse-threshold-tune-report.json"), "utf8"));
  const d = report.decisions.find((x) => x.signal_id === "mfg-activity");
  check("action=auto_apply", d && d.action === "auto_apply", d && d.action);

  // LIVE registry in the tree is untouched; only the temp out copy got the value.
  check("live registry untouched", fs.readFileSync(regPath, "utf8") === regBefore);
  check("registry-out written", fs.existsSync(outPath));
  const out = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const mfg = out.signals.find((s) => s.signal_id === "mfg-activity");
  check("out registry has bounded exception_threshold 9.5", mfg && Math.abs(mfg.thresholds.exception_threshold - 9.5) < 1e-9,
    mfg && String(mfg.thresholds.exception_threshold));
  check("applied value within +15% bound (<=10.0625)", mfg && mfg.thresholds.exception_threshold <= 10.0625 + 1e-9);

  // change-log entry disposition=applied
  const cl = evidence.readLedger(path.join(dir, "automation", "threshold-change-log.jsonl"));
  check("change-log disposition=applied", cl.length === 1 && cl[0].disposition === "applied", JSON.stringify(cl));
  cleanup(dir);
}

// ===========================================================================
// J) gate with no ingested recommendation => exit 2
// ===========================================================================
function testGateNoInputs() {
  console.log("\nJ) gate without inputs => exit 2:");
  const dir = setupTree({ ledger: eligibleLedger() });
  const res = run(dir, ["--threshold-tune-gate"]);
  check("exit 2 when no recommendation ingested", res.status === 2, "status=" + res.status);
  cleanup(dir);
}

// ===========================================================================
// K) the REAL repo artifacts are never created by these tests
// ===========================================================================
function testRealUntouched() {
  console.log("\nK) real repo artifacts untouched:");
  check("no real threshold-evidence.jsonl created", !fs.existsSync(path.join(ROOT, "automation", "threshold-evidence.jsonl")));
  check("no real threshold-change-log.jsonl created", !fs.existsSync(path.join(ROOT, "automation", "threshold-change-log.jsonl")));
  check("no real tune-report created", !fs.existsSync(path.join(ROOT, "data", "pulse-threshold-tune-report.json")));
  // registry has NO seeded exception_threshold (the PR must not seed values)
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "signals_registry.json"), "utf8"));
  const seeded = reg.signals.filter((s) => s.thresholds && typeof s.thresholds.exception_threshold === "number");
  check("real registry has no seeded exception_threshold", seeded.length === 0, seeded.map((s) => s.signal_id).join(","));
}

function main() {
  console.log("[threshold-tune] Phase B regression\n");
  testPrepInsufficient();
  testPrepEligible();
  testPrepCooldown();
  testIngest();
  testGatePropose();
  testGateClamp();
  testGateCeiling();
  testGateRejections();
  testGateAutoApplyDormant();
  testGateNoInputs();
  testRealUntouched();
  console.log("");
  if (failures > 0) {
    console.error(`[threshold-tune] FAIL: ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("[threshold-tune] PASS: analyzer + gate bounds/cooldown/validator/auto_apply correct.");
}

main();
