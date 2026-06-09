#!/usr/bin/env node
/* ========================================================================
   Replay test for the trigger-freshness fix in scripts/draft-editorial.js.

   Proves:
     A) A pre-fix snapshot (no triggering_observations map) + a month-old
        material move => SUPPRESSED on first run (seed-on-migration). decision
        depends only on other triggers, NOT on the stale move.
     B) Re-running with the SAME data + the snapshot we just wrote => still
        suppressed (carried-forward map). No daily re-fire.
     C) A genuinely NEW observation (newer date) that moves materially => FIRES
        exactly once, then is suppressed on the subsequent identical run.

   Method: run the REAL draft-editorial.js as a child process against a throwaway
   working copy of data/, with editorial config forced to phase 0 (emit inert),
   and inspect the decision snapshot it writes. We never touch the repo's real
   data files.

   Dependency-free, offline (no signal fetch happens in draft-editorial).
   Exit 0 = all assertions pass.
   ======================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "draft-editorial.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Build a minimal content.json with one signal whose last two data points
// constitute a material move (direction flip + big magnitude), dated `obsDate`.
function makeContent(obsDate) {
  return {
    signals: [
      {
        id: "mfg-activity",
        data_points: [
          { date: "2026-03", value: 16.3 },
          { date: "2026-04", value: 26.7 },
          { date: obsDate, value: -0.4 }
        ],
        last_updated: obsDate + "-01",
        timestamps: { latest_source_data_date: obsDate + "-01", last_editorial_reviewed: "2026-06-09" }
      }
    ],
    // Keep weekly connection fresh so editorial_stale does NOT fire and pollute
    // the decision — we want to isolate the material-move trigger.
    weekly_connection: { last_editorial_reviewed: isoToday(), date: isoToday() }
  };
}

function isoToday() { return new Date().toISOString().slice(0, 10); }

// Minimal registry: thresholds that make a -27 move on mfg-activity material.
function makeRegistry() {
  return {
    editorial_freshness_policy: { weekly_connection_expires_after_days: 7 },
    signals: [
      {
        signal_id: "mfg-activity",
        name: "Manufacturing Activity",
        thresholds: {
          expected_range: [-60, 60],
          max_abs_step: 10,
          max_abs_step_hard: 25,
          centered_zero: true
        },
        cadence: { cadence: "monthly" }
      }
    ]
  };
}

function setupWorkdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-trigger-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "automation"), { recursive: true });
  // Copy the scripts the child needs: draft-editorial + its deps.
  copy(path.join(ROOT, "scripts", "draft-editorial.js"), path.join(dir, "scripts", "draft-editorial.js"));
  copy(path.join(ROOT, "scripts", "emit-editorial-task.js"), path.join(dir, "scripts", "emit-editorial-task.js"));
  copy(path.join(ROOT, "scripts", "lib", "pulse-trust.js"), path.join(dir, "scripts", "lib", "pulse-trust.js"));
  // Force phase 0 so the emit step stays inert (we only test the decision).
  fs.writeFileSync(path.join(dir, "automation", "editorial-config.json"),
    JSON.stringify({ editorial_automation_phase: 0, kill_switch: { editorial_automation_enabled: true } }, null, 2));
  return dir;
}

function copy(src, dst) {
  if (fs.existsSync(src)) fs.copyFileSync(src, dst);
}

// Run draft-editorial.js inside the workdir, return the decision snapshot it wrote.
function runOnce(dir) {
  const res = spawnSync(process.execPath, [path.join(dir, "scripts", "draft-editorial.js")],
    { cwd: dir, encoding: "utf8", timeout: 20000 });
  if (res.status !== 0) {
    throw new Error(`draft-editorial exited ${res.status}\n${res.stdout}\n${res.stderr}`);
  }
  const snap = JSON.parse(fs.readFileSync(path.join(dir, "data", "pulse-editorial-decision.json"), "utf8"));
  return { snap, stdout: res.stdout };
}

function writeData(dir, content, registry, priorSnapshot) {
  fs.writeFileSync(path.join(dir, "data", "pulse-content.json"), JSON.stringify(content, null, 2));
  fs.writeFileSync(path.join(dir, "data", "signals_registry.json"), JSON.stringify(registry, null, 2));
  if (priorSnapshot) {
    fs.writeFileSync(path.join(dir, "data", "pulse-editorial-decision.json"), JSON.stringify(priorSnapshot, null, 2));
  } else {
    // remove any leftover snapshot
    try { fs.unlinkSync(path.join(dir, "data", "pulse-editorial-decision.json")); } catch (e) {}
  }
}

function hasMaterialTrigger(snap) {
  return (snap.triggers || []).some((t) => t.type === "material_data_move");
}

function main() {
  console.log("[trigger-freshness] Replaying draft-editorial.js trigger behavior\n");
  const reg = makeRegistry();
  const dir = setupWorkdir();

  // --- Scenario A: pre-fix snapshot (no map) + month-old material move -----
  console.log("A) Pre-fix snapshot + stale month-old move (seed-on-migration):");
  const preFixSnapshot = {
    generated_at: "2026-06-08T17:21:00.000Z",
    decision: "DRAFT",
    triggers: [{ type: "material_data_move", detail: "1 signal(s) moved materially", signals: [{ id: "mfg-activity", from: 26.7, to: -0.4 }] }]
    // NOTE: intentionally NO triggering_observations (simulates old format)
  };
  writeData(dir, makeContent("2026-05"), reg, preFixSnapshot);
  const a = runOnce(dir);
  check("stale move is SUPPRESSED (no material trigger)", !hasMaterialTrigger(a.snap),
    `triggers=${JSON.stringify((a.snap.triggers || []).map((t) => t.type))}`);
  check("decision is KEEP (no other triggers)", a.snap.decision === "KEEP", `decision=${a.snap.decision}`);
  check("snapshot now carries triggering_observations for mfg-activity",
    a.snap.triggering_observations && a.snap.triggering_observations["mfg-activity"] === "2026-05",
    `map=${JSON.stringify(a.snap.triggering_observations)}`);
  check("suppressed move is recorded for audit",
    (a.snap.suppressed_stale_moves || []).some((m) => m.id === "mfg-activity"),
    `suppressed=${JSON.stringify(a.snap.suppressed_stale_moves)}`);

  // --- Scenario B: re-run with same data + carried-forward map -------------
  console.log("\nB) Re-run, same data, carried-forward map (no daily re-fire):");
  writeData(dir, makeContent("2026-05"), reg, a.snap);
  const b = runOnce(dir);
  check("still SUPPRESSED on re-run", !hasMaterialTrigger(b.snap),
    `triggers=${JSON.stringify((b.snap.triggers || []).map((t) => t.type))}`);
  check("decision stays KEEP", b.snap.decision === "KEEP", `decision=${b.snap.decision}`);

  // --- Scenario C: a genuinely NEW observation fires once, then suppresses --
  console.log("\nC) NEW observation (newer date) fires exactly once:");
  // New month observation; the last two points are 26.7 -> -0.4 again but dated 2026-06.
  writeData(dir, makeContent("2026-06"), reg, b.snap);
  const c1 = runOnce(dir);
  check("NEW observation FIRES a material trigger", hasMaterialTrigger(c1.snap),
    `triggers=${JSON.stringify((c1.snap.triggers || []).map((t) => t.type))}`);
  check("decision is DRAFT on the new observation", c1.snap.decision === "DRAFT", `decision=${c1.snap.decision}`);
  check("map updated to 2026-06",
    c1.snap.triggering_observations && c1.snap.triggering_observations["mfg-activity"] === "2026-06",
    `map=${JSON.stringify(c1.snap.triggering_observations)}`);
  // Re-run identical -> must suppress now.
  writeData(dir, makeContent("2026-06"), reg, c1.snap);
  const c2 = runOnce(dir);
  check("same NEW observation does NOT re-fire next run", !hasMaterialTrigger(c2.snap),
    `triggers=${JSON.stringify((c2.snap.triggers || []).map((t) => t.type))}`);

  // cleanup
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}

  console.log("");
  if (failures > 0) {
    console.error(`[trigger-freshness] FAIL: ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("[trigger-freshness] PASS: stale moves suppress, new observations fire exactly once.");
}

main();
