#!/usr/bin/env node
/* =============================================================================
   test-gate-selfheal.js — crash-recovery for the gate's structural-test swap
   -----------------------------------------------------------------------------
   Dependency-free (Node built-ins only). Does NOT call any AI.

   The gate (editorial-runner --gate) runs the test suites against an APPLIED
   content tree by backing live content up to <pulse-content.json>.gatebak,
   swapping the applied tree in, then restoring in a `finally`. A `finally`
   cannot run if the process is hard-killed mid-swap, which could otherwise
   leave AI-drafted content in the live data file. selfHealGatebak() runs FIRST
   on every editorial-runner invocation and restores the pre-swap live content
   from any stray .gatebak.

   This test simulates an interrupted gate (a stray .gatebak plus a tampered
   live file) and asserts the next runner invocation restores the live content
   byte-for-byte and removes the backup. It carefully backs up and restores the
   real live file so the test itself never leaves the repo dirty.
   ===========================================================================*/
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const RUNNER = path.join(ROOT, "automation", "editorial-runner.js");
const CONTENT_PATH = path.join(ROOT, "data", "pulse-content.json");
const GATEBAK = CONTENT_PATH + ".gatebak";

let failures = 0;
function ok(name, cond) {
  if (cond) { console.log("  ok  - " + name); }
  else { console.log("  FAIL- " + name); failures++; }
}

// Snapshot the real live content so we can guarantee a clean repo afterward.
const original = fs.readFileSync(CONTENT_PATH, "utf8");

try {
  // --- Simulate an interrupted gate -----------------------------------------
  // .gatebak holds the REAL pre-swap content (what the gate backed up).
  fs.writeFileSync(GATEBAK, original);
  // The live file is left as tampered "applied" content (what a crash leaves).
  const tampered = JSON.parse(original);
  tampered.weekly_connection = tampered.weekly_connection || {};
  tampered.weekly_connection.title = "TAMPERED — should be restored by self-heal";
  fs.writeFileSync(CONTENT_PATH, JSON.stringify(tampered, null, 2) + "\n");

  // Sanity: the live file really is tampered right now.
  const before = JSON.parse(fs.readFileSync(CONTENT_PATH, "utf8"));
  ok("precondition: live file is tampered", before.weekly_connection.title.indexOf("TAMPERED") === 0);
  ok("precondition: .gatebak exists", fs.existsSync(GATEBAK));

  // --- Run any runner command; selfHealGatebak() must fire first ------------
  // --validate-prep is a read-only, no-op-safe command. We ignore its exit
  // code (it may exit non-zero because there's no draft) — we only care that
  // the self-heal ran before the command did its thing.
  try {
    execFileSync("node", [RUNNER, "--validate-prep"], { cwd: ROOT, stdio: "pipe" });
  } catch (e) { /* expected: command may exit non-zero; self-heal already ran */ }

  // --- Assertions -----------------------------------------------------------
  const after = fs.readFileSync(CONTENT_PATH, "utf8");
  ok("live content restored byte-for-byte", after === original);
  ok("stray .gatebak removed after self-heal", !fs.existsSync(GATEBAK));

  // --- Idempotency: a second run with no .gatebak must be a clean no-op -----
  try {
    execFileSync("node", [RUNNER, "--validate-prep"], { cwd: ROOT, stdio: "pipe" });
  } catch (e) { /* same as above */ }
  const after2 = fs.readFileSync(CONTENT_PATH, "utf8");
  ok("no-op when no .gatebak present (content unchanged)", after2 === original);
  ok("still no .gatebak after no-op run", !fs.existsSync(GATEBAK));
} finally {
  // Guarantee the repo is left exactly as we found it, no matter what.
  fs.writeFileSync(CONTENT_PATH, original);
  if (fs.existsSync(GATEBAK)) fs.unlinkSync(GATEBAK);
}

if (failures) {
  console.log("[gate-selfheal] FAIL: " + failures + " check(s) failed.");
  process.exit(1);
}
console.log("[gate-selfheal] PASS: interrupted-gate swap self-heals; live content protected.");
process.exit(0);
