#!/usr/bin/env node
/* =============================================================================
   test-narrative-consistency.js — reversal-detection regression (Phase 3)
   -----------------------------------------------------------------------------
   Dependency-free (Node built-ins only). No AI, no network, no live-file writes.

   Asserts the narrative-reversal floor under the AI panel:
     · A reversal whose DATA direction supports the new prose ("supported") is a
       SOFT warning only — pass stays true, one soft_warning, no hard failure.
     · A reversal whose DATA direction does NOT move to support the new prose
       ("unsupported") is a HARD failure — pass=false.
     · No flip (same status on both sides) is clean — no reversals at all.
     · A signal with a non-directional stance on either side ("mixed"/"steady")
       can never form a reversal.
     · A signal present on only one side cannot reverse.
     · Reversal records carry the shape the runner folds into the report
       (signal_id, prev_polarity, new_polarity, excerpts, supported flag).

   Fixtures are SELF-CONTAINED inline objects (a minimal registry + signals), so
   the test stays deterministic even if the live registry / content evolve. The
   one polarity exercised is `value_up_is_negative` (the CPI/inflation family):
   status "rising" -> editorial direction "up"; "falling" -> "down".
   ===========================================================================*/
"use strict";

const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const nc = require(path.join(ROOT, "scripts", "lib", "narrative-consistency.js"));

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  ok  - " + name); }
  else { console.log("  FAIL- " + name + (detail ? " — " + detail : "")); failures++; }
}

console.log("test-narrative-consistency");

// Minimal registry: one inflation-like signal with value_up_is_negative polarity,
// data direction read from compared_to.vs_12mo.direction (matches the live entry).
const REGISTRY = {
  signals: [
    { signal_id: "infl", alignment: { direction_field: "compared_to.vs_12mo.direction", editorial_polarity: "value_up_is_negative" } }
  ]
};

function sig(status, dataDir, summary) {
  return {
    id: "infl",
    status: status,
    summary: summary || ("Prices " + status + " over the year."),
    compared_to: { vs_12mo: { direction: dataDir } }
  };
}
function page(signal) { return { signals: [signal] }; }

/* ---- direction primitives behave as documented ---- */
ok("'rising' -> editorial up (value_up_is_negative)", nc.editorialDirection(sig("rising", "up"), REGISTRY) === "up");
ok("'falling' -> editorial down", nc.editorialDirection(sig("falling", "up"), REGISTRY) === "down");
ok("'mixed' -> no directional stance (null)", nc.editorialDirection(sig("mixed", "up"), REGISTRY) === null);
ok("dataDirection reads vs_12mo (up)", nc.dataDirection(sig("rising", "up"), REGISTRY) === "up");
ok("dataDirection reads vs_12mo (down)", nc.dataDirection(sig("rising", "down"), REGISTRY) === "down");
ok("isReversal up->down", nc.isReversal("up", "down") === true);
ok("isReversal up->up is not a reversal", nc.isReversal("up", "up") === false);

/* ---- SUPPORTED reversal: prose flips AND data agrees -> soft only ---- */
(function () {
  // prev: falling (down) ; new: rising (up) ; data: up -> supports the NEW (up)
  const prev = page(sig("falling", "up", "Prices fell over the year."));
  const next = page(sig("rising", "up", "Prices rose over the year."));
  const r = nc.checkConsistency(prev, next, { registry: REGISTRY });
  ok("supported reversal: pass stays true", r.pass === true, JSON.stringify(r));
  ok("supported reversal: exactly one reversal recorded", r.reversals.length === 1);
  ok("supported reversal: one soft_warning", r.soft_warnings.length === 1);
  ok("supported reversal: no hard_failure", r.hard_failures.length === 0);
  ok("supported reversal: marked supported=true", r.reversals[0] && r.reversals[0].supported === true);
  ok("supported reversal: prev/new polarity recorded",
    r.reversals[0] && r.reversals[0].prev_polarity === "down" && r.reversals[0].new_polarity === "up");
})();

/* ---- UNSUPPORTED reversal: prose flips, data did NOT move -> hard fail ---- */
(function () {
  // prev: rising (up) ; new: falling (down) ; data stays up -> does NOT support down
  const prev = page(sig("rising", "up", "Prices rose over the year."));
  const next = page(sig("falling", "up", "Prices fell over the year."));
  const r = nc.checkConsistency(prev, next, { registry: REGISTRY });
  ok("unsupported reversal: pass=false (hard concern)", r.pass === false, JSON.stringify(r));
  ok("unsupported reversal: one reversal recorded", r.reversals.length === 1);
  ok("unsupported reversal: one hard_failure", r.hard_failures.length === 1);
  ok("unsupported reversal: no soft_warning", r.soft_warnings.length === 0);
  ok("unsupported reversal: marked supported=false", r.reversals[0] && r.reversals[0].supported === false);
  ok("unsupported reversal: excerpt carries new prose",
    r.reversals[0] && /fell/i.test(r.reversals[0].new_excerpt));
})();

/* ---- no flip: identical status both sides -> clean ---- */
(function () {
  const same = page(sig("rising", "up"));
  const r = nc.checkConsistency(same, same, { registry: REGISTRY });
  ok("no flip: pass=true", r.pass === true);
  ok("no flip: zero reversals", r.reversals.length === 0);
  ok("no flip: zero soft + zero hard", r.soft_warnings.length === 0 && r.hard_failures.length === 0);
})();

/* ---- non-directional stance on a side cannot reverse ---- */
(function () {
  const prev = page(sig("rising", "up"));        // up
  const next = page(sig("mixed", "up"));          // null -> no stance
  const r = nc.checkConsistency(prev, next, { registry: REGISTRY });
  ok("non-directional new stance: no reversal", r.reversals.length === 0 && r.pass === true);
})();

/* ---- signal present on only one side cannot reverse ---- */
(function () {
  const prev = page(sig("rising", "up"));
  const next = { signals: [] };
  const r = nc.checkConsistency(prev, next, { registry: REGISTRY });
  ok("missing-on-new-side: no reversal", r.reversals.length === 0 && r.pass === true);
})();

/* ---- without a registry, polarity defaults — STILL must not crash ---- */
(function () {
  const prev = page(sig("rising", "up"));
  const next = page(sig("falling", "up"));
  const r = nc.checkConsistency(prev, next, {}); // no registry
  ok("no registry: returns a well-formed result (no throw)",
    r && typeof r.pass === "boolean" && Array.isArray(r.reversals));
})();

if (failures > 0) { console.error("\ntest-narrative-consistency: " + failures + " FAILURE(S)"); process.exit(1); }
console.log("\ntest-narrative-consistency: all checks passed");
process.exit(0);
