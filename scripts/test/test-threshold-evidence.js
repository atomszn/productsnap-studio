#!/usr/bin/env node
/* =============================================================================
   test-threshold-evidence.js — regression suite for Phase A of the
   threshold-evolution loop:
     - scripts/lib/threshold-evidence.js  (record building + append round-trip)
     - scripts/lib/threshold-outcomes.js  (FP + missed-signal heuristics, stats)
     - automation/schemas/threshold-evidence.schema.json (records validate)
     - editorial-runner --record-evidence / --threshold-evidence-summary
           (exit codes + behavior, exercised in a throwaway repo tree)

   No mutation of the real ledger/registry: append round-trips use a temp JSONL,
   and the subcommand tests run a COPY of the runner against fixture data in a
   temp tree (the runner resolves paths off its own __dirname). Dependency-free,
   offline. Exit 0 = all assertions pass.
   ===========================================================================*/
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const evidence = require(path.join(ROOT, "scripts", "lib", "threshold-evidence.js"));
const outcomes = require(path.join(ROOT, "scripts", "lib", "threshold-outcomes.js"));
const { validate } = require(path.join(ROOT, "scripts", "lib", "schema-validate.js"));
const { classifyMateriality } = require(path.join(ROOT, "scripts", "lib", "materiality.js"));
const EVIDENCE_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(ROOT, "automation", "schemas", "threshold-evidence.schema.json"), "utf8")
);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// --- registry + decision fixtures ------------------------------------------
function registry() {
  return {
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

// ===========================================================================
// A) buildEvidenceRecord — weekly vs exception_probe tier via dow override
// ===========================================================================
function testRecordBuilding() {
  console.log("A) buildEvidenceRecord tier + shape:");
  const reg = registry();
  const dec = moveDecision([{ id: "cpi-headline", from: 3.81, to: 4.30, delta: 0.49 }]);
  const cls = classifyMateriality(dec, reg);

  // Mon-Thu (dow 2) => exception_probe; material move => proceeded true, exit 0.
  let r = evidence.buildEvidenceRecord({
    decision: dec, registry: reg, classification: cls,
    routing_outcome: { exit_code: 0 }, decision_date: "2026-05-02", dow: 2
  });
  check("tier exception_probe for dow 2", r.tier === "exception_probe", r.tier);
  check("decision DRAFT", r.decision === "DRAFT");
  check("one scored signal", r.signals.length === 1);
  check("signal is_material true", r.signals[0].is_material === true);
  check("routing proceeded true (exit 0)", r.routing_outcome.proceeded === true);
  check("routing exit_code 0", r.routing_outcome.exit_code === 0);
  check("downstream null", r.downstream === null);

  // Friday (dow 5) => weekly tier.
  r = evidence.buildEvidenceRecord({
    decision: dec, registry: reg, classification: cls,
    routing_outcome: { exit_code: 0 }, decision_date: "2026-05-02", dow: 5
  });
  check("tier weekly for dow 5", r.tier === "weekly", r.tier);

  // explicit tier override wins
  r = evidence.buildEvidenceRecord({
    decision: dec, registry: reg, classification: cls,
    routing_outcome: { exit_code: 3 }, dow: 2, tier: "weekly"
  });
  check("explicit tier override honored", r.tier === "weekly");
  check("exit 3 => proceeded false", r.routing_outcome.proceeded === false);

  // suppressed move flagged
  const decSup = moveDecision(
    [{ id: "mfg-activity", from: -0.4, to: 10.3, delta: 10.7 }],
    { suppressed_stale_moves: [{ id: "mfg-activity", from: -0.4, to: 10.3 }] }
  );
  const clsSup = classifyMateriality(decSup, reg);
  r = evidence.buildEvidenceRecord({
    decision: decSup, registry: reg, classification: clsSup,
    routing_outcome: { exit_code: 0 }, dow: 3
  });
  check("in_suppressed_moves true when id in suppressed list", r.signals[0].in_suppressed_moves === true);
}

// ===========================================================================
// B) schema validity of built records
// ===========================================================================
function testSchema() {
  console.log("\nB) records validate against the schema:");
  const reg = registry();
  const dec = moveDecision([{ id: "cpi-headline", from: 3.81, to: 4.30, delta: 0.49 }]);
  const cls = classifyMateriality(dec, reg);
  const r = evidence.buildEvidenceRecord({
    decision: dec, registry: reg, classification: cls,
    routing_outcome: { exit_code: 0 }, decision_date: "2026-05-02", dow: 2
  });
  const v = validate(r, EVIDENCE_SCHEMA);
  check("built record is schema-valid", v.valid, JSON.stringify(v.errors));

  // narrative-only (no signals) record also valid
  const decN = { generated_at: "2026-05-03T12:00:00.000Z", decision: "DRAFT", triggers: [{ type: "editorial_stale", detail: "aged" }] };
  const clsN = classifyMateriality(decN, reg);
  const rN = evidence.buildEvidenceRecord({ decision: decN, registry: reg, classification: clsN, routing_outcome: { exit_code: 3 }, dow: 4 });
  const vN = validate(rN, EVIDENCE_SCHEMA);
  check("narrative-only record is schema-valid", vN.valid, JSON.stringify(vN.errors));
  check("narrative-only has empty signals", rN.signals.length === 0);

  // a deliberately malformed record fails (bad enum)
  const bad = JSON.parse(JSON.stringify(r));
  bad.tier = "bogus";
  check("bad tier rejected by schema", validate(bad, EVIDENCE_SCHEMA).valid === false);
}

// ===========================================================================
// C) append round-trip (temp jsonl, NOT the real ledger)
// ===========================================================================
function testAppendRoundTrip() {
  console.log("\nC) append round-trip via temp JSONL:");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-te-"));
  const ledgerPath = path.join(dir, "evidence.jsonl");
  const reg = registry();
  const recs = [
    evidence.buildEvidenceRecord({ decision: moveDecision([{ id: "cpi-headline", from: 3.0, to: 3.5, delta: 0.5 }]), registry: reg, classification: classifyMateriality(moveDecision([{ id: "cpi-headline", from: 3.0, to: 3.5, delta: 0.5 }]), reg), routing_outcome: { exit_code: 0 }, dow: 2 }),
    evidence.buildEvidenceRecord({ decision: moveDecision([{ id: "cpi-headline", from: 3.0, to: 3.05, delta: 0.05 }]), registry: reg, classification: classifyMateriality(moveDecision([{ id: "cpi-headline", from: 3.0, to: 3.05, delta: 0.05 }]), reg), routing_outcome: { exit_code: 3 }, dow: 3 })
  ];
  recs.forEach((r) => evidence.appendEvidence(r, { path: ledgerPath }));
  const read = evidence.readLedger(ledgerPath);
  check("two records round-trip", read.length === 2, "got " + read.length);
  check("first record material", read[0].signals[0].is_material === true);
  check("second record not material", read[1].signals[0].is_material === false);
  // tolerant of blank lines
  fs.appendFileSync(ledgerPath, "\n\n");
  check("blank lines tolerated", evidence.readLedger(ledgerPath).length === 2);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ===========================================================================
// D) perSignalStats + summary math
// ===========================================================================
function testStats() {
  console.log("\nD) perSignalStats math:");
  const reg = registry();
  const ledger = [
    mk(reg, [{ id: "cpi-headline", from: 3.0, to: 3.5, delta: 0.5 }], 0),   // material
    mk(reg, [{ id: "cpi-headline", from: 3.0, to: 3.05, delta: 0.05 }], 3), // not
    mk(reg, [{ id: "cpi-headline", from: 3.0, to: 3.4, delta: 0.4 }], 0)    // material
  ];
  const stats = outcomes.perSignalStats(ledger);
  check("times_seen 3", stats["cpi-headline"].times_seen === 3);
  check("times_material 2", stats["cpi-headline"].times_material === 2);
  check("fire_rate 2/3", Math.abs(stats["cpi-headline"].fire_rate - 2 / 3) < 1e-9);
}

function mk(reg, signals, exit, extra) {
  const dec = moveDecision(signals, extra);
  return evidence.buildEvidenceRecord({
    decision: dec, registry: reg, classification: classifyMateriality(dec, reg),
    routing_outcome: { exit_code: exit }, dow: 2
  });
}

// ===========================================================================
// E) falsePositiveCandidates heuristic
// ===========================================================================
function testFalsePositives() {
  console.log("\nE) falsePositiveCandidates:");
  const reg = registry();
  // proceeded midweek + material, downstream held_below_bar => FP candidate
  const r1 = mk(reg, [{ id: "cpi-headline", from: 3.0, to: 3.5, delta: 0.5 }], 0);
  r1.downstream = { gate_action: "held_below_bar", panel_min_confidence: 0.8 };
  // proceeded + material but published cleanly (high conf) => NOT FP
  const r2 = mk(reg, [{ id: "cpi-headline", from: 3.0, to: 3.6, delta: 0.6 }], 0);
  r2.downstream = { gate_action: "auto_publish", panel_min_confidence: 0.97 };
  // proceeded + material, low panel conf => FP candidate
  const r3 = mk(reg, [{ id: "cpi-headline", from: 3.0, to: 3.7, delta: 0.7 }], 0);
  r3.downstream = { gate_action: "auto_publish", panel_min_confidence: 0.62 };
  // proceeded + material but downstream unknown => NOT labeled (no guessing)
  const r4 = mk(reg, [{ id: "cpi-headline", from: 3.0, to: 3.8, delta: 0.8 }], 0);

  const fp = outcomes.falsePositiveCandidates([r1, r2, r3, r4]);
  check("2 FP candidates (held + low-conf)", fp.length === 2, "got " + fp.length);
  check("clean publish not flagged", !fp.some((e) => e.gate_action === "auto_publish" && e.panel_min_confidence === 0.97));
  check("unknown downstream not flagged", fp.length === 2);
}

// ===========================================================================
// F) missedSignalCandidates heuristic (near-miss + recurrence)
// ===========================================================================
function testMissed() {
  console.log("\nF) missedSignalCandidates:");
  const reg = registry();
  // mfg-activity threshold derived = 0.35*25 = 8.75.
  // near-miss: held move with abs_delta 8.0 (in [7.4375, 8.75)) => candidate
  const held = mk(reg, [{ id: "mfg-activity", from: 0, to: 8.0, delta: 8.0 }], 3);
  // recurrence: same signal later material within window
  const later = mk(reg, [{ id: "mfg-activity", from: 0, to: 10.0, delta: 10.0 }], 0);
  const m = outcomes.missedSignalCandidates([held, later]);
  const mfg = m.find((x) => x.signal_id === "mfg-activity");
  check("mfg flagged", !!mfg && mfg.missed_candidate_count >= 1, JSON.stringify(mfg));
  check("near-miss counted", mfg.near_miss_count === 1, "near_miss=" + (mfg && mfg.near_miss_count));
  check("recurrence counted", mfg.recurrence_count === 1, "recurrence=" + (mfg && mfg.recurrence_count));

  // a far-below held move with no recurrence => not a candidate
  const far = mk(reg, [{ id: "mfg-activity", from: 0, to: 1.0, delta: 1.0 }], 3);
  const m2 = outcomes.missedSignalCandidates([far]);
  const mfg2 = m2.find((x) => x.signal_id === "mfg-activity");
  check("far-below not a missed candidate", mfg2.missed_candidate_count === 0, JSON.stringify(mfg2));
  check("held_count still recorded", mfg2.held_count === 1);
}

// ===========================================================================
// G) subcommand exit codes in a throwaway repo tree
// ===========================================================================
function copy(src, dst) { if (fs.existsSync(src)) fs.copyFileSync(src, dst); }
function setupTree(decision) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-te-run-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.mkdirSync(path.join(dir, "automation", "schemas"), { recursive: true });
  fs.mkdirSync(path.join(dir, "automation", "prompts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts", "test"), { recursive: true });

  copy(path.join(ROOT, "automation", "editorial-runner.js"), path.join(dir, "automation", "editorial-runner.js"));
  copy(path.join(ROOT, "automation", "automation-config.json"), path.join(dir, "automation", "automation-config.json"));
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

  fs.writeFileSync(path.join(dir, "data", "signals_registry.json"), JSON.stringify(registry(), null, 2));
  if (decision !== undefined) {
    fs.writeFileSync(path.join(dir, "data", "pulse-editorial-decision.json"), JSON.stringify(decision, null, 2));
  }
  return dir;
}
function run(dir, args) {
  return spawnSync(process.execPath, [path.join(dir, "automation", "editorial-runner.js")].concat(args),
    { cwd: dir, encoding: "utf8", timeout: 30000, env: Object.assign({}, process.env) });
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }

function testSubcommands() {
  console.log("\nG) --record-evidence / --threshold-evidence-summary subcommands:");

  // record-evidence appends + exits 0; ledger written into the temp tree only
  let dir = setupTree(moveDecision([{ id: "cpi-headline", from: 3.81, to: 4.30, delta: 0.49 }]));
  let res = run(dir, ["--record-evidence", "--dow", "2"]);
  check("record-evidence exit 0", res.status === 0, "status=" + res.status + " err=" + (res.stderr || ""));
  const ledgerPath = path.join(dir, "automation", "threshold-evidence.jsonl");
  check("ledger file created", fs.existsSync(ledgerPath));
  const recs = evidence.readLedger(ledgerPath);
  check("one record appended", recs.length === 1);
  check("record schema-valid", validate(recs[0], EVIDENCE_SCHEMA).valid);
  check("real repo ledger untouched", !fs.existsSync(path.join(ROOT, "automation", "threshold-evidence.jsonl")) ||
    fs.readFileSync(path.join(ROOT, "automation", "threshold-evidence.jsonl"), "utf8").indexOf(recs[0].recorded_at) === -1);

  // a second record, then summary reads exit 0 with counts
  run(dir, ["--record-evidence", "--dow", "3"]);
  res = run(dir, ["--threshold-evidence-summary"]);
  check("summary exit 0", res.status === 0, "status=" + res.status);
  const sum = safeParse(res.stdout);
  check("summary total_records 2", sum && sum.total_records === 2, sum && String(sum.total_records));
  check("summary has per_signal cpi", sum && sum.per_signal.some((s) => s.signal_id === "cpi-headline"));
  cleanup(dir);

  // record-evidence exit 2 on missing decision
  dir = setupTree(undefined);
  res = run(dir, ["--record-evidence"]);
  check("record-evidence exit 2 when decision missing", res.status === 2, "status=" + res.status);
  cleanup(dir);
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function main() {
  console.log("[threshold-evidence] Phase A regression\n");
  testRecordBuilding();
  testSchema();
  testAppendRoundTrip();
  testStats();
  testFalsePositives();
  testMissed();
  testSubcommands();
  console.log("");
  if (failures > 0) {
    console.error(`[threshold-evidence] FAIL: ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("[threshold-evidence] PASS: evidence ledger + outcomes + subcommands correct.");
}

main();
