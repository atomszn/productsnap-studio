"use strict";
/* =============================================================================
   threshold-evidence.js — deterministic evidence-ledger writer (dep-free)
   -----------------------------------------------------------------------------
   Phase A of the threshold-evolution loop (see threshold_evolution_spec.md).

   Today the editorial-materiality classifier (scripts/lib/materiality.js) runs
   on every cron cycle, decides whether a data move warrants a midweek exception
   publish, and then EXITS leaving no trace. Without a trace there is nothing to
   tune: we cannot tell, weeks later, whether the exception bar fired too often
   (noisy false positives) or too rarely (missed real signals). This module
   turns every routing decision into an append-only, schema-checked audit record.

   It is purely additive and READ-ONLY w.r.t. the registry: it can NEVER change a
   threshold. It records what the classifier already decided, plus the cron's
   routing outcome (proceeded midweek vs. held for Friday) and which moved
   signals were in the decision's `suppressed_stale_moves[]` list (the
   missed-signal raw material the design calls for).

   Two functions, by design:
     buildEvidenceRecord(...)  pure — returns a record object, NO fs.
     appendEvidence(record,..) the only side-effecting fn — one JSON per line.

   CommonJS, Node built-ins only. Mirrors the style of materiality.js.
   ===========================================================================*/

const fs = require("fs");

const SCHEMA_VERSION = "1.0.0";

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Build a set of signal ids that appear in the decision's suppressed_stale_moves.
// These are moves that did NOT trigger an exception (held for Friday) — the raw
// material for missed-signal detection. Pure.
function suppressedMoveIds(decision) {
  const out = {};
  const list = decision && Array.isArray(decision.suppressed_stale_moves)
    ? decision.suppressed_stale_moves : [];
  list.forEach((m) => { if (m && m.id) out[m.id] = true; });
  return out;
}

// Map the cron's routing exit code (from --classify-materiality) to a structured
// outcome. The cron PROCEEDS with a midweek exception only on exit 0
// (any_material true). Exit 3 = held for Friday. Exit 2 = could not classify.
function routingOutcomeFromExit(exitCode, reason) {
  const code = isFiniteNumber(exitCode) ? exitCode : null;
  return {
    proceeded: code === 0,
    exit_code: code === 0 || code === 3 || code === 2 ? code : null,
    reason: typeof reason === "string" && reason.length
      ? reason
      : (code === 0 ? "material move cleared exception threshold"
        : code === 3 ? "no material move — held for Friday synthesis"
        : code === 2 ? "could not classify (missing/invalid inputs)"
        : "unspecified")
  };
}

/**
 * buildEvidenceRecord — pure. Turns one classification + routing outcome into a
 * single evidence record (schema: automation/schemas/threshold-evidence.schema.json).
 *
 * @param {object} args
 *   - decision         parsed pulse-editorial-decision.json (for suppressed list + decision word)
 *   - registry         parsed signals_registry.json (unused directly here; classification carries thresholds)
 *   - classification   output of materiality.classifyMateriality(decision, registry, opts)
 *   - routing_outcome  { exit_code, reason } OR a pre-built outcome (proceeded/exit_code/reason)
 *   - decision_date    "YYYY-MM-DD" or "YYYY-MM" (mirrors decision.generated_at / observation dates)
 *   - dow              0-6 UTC day-of-week (Sun=0). If absent, derived from `now`.
 *   - tier             "weekly" | "exception_probe". If absent, derived from dow (Fri=weekly else probe).
 *   - now              Date for recorded_at (defaults to new Date()).
 * @returns {object} the evidence record (downstream:null — filled later).
 */
function buildEvidenceRecord(args) {
  args = args || {};
  const decision = args.decision || {};
  const classification = args.classification || {};
  const now = args.now instanceof Date ? args.now : new Date();

  const dow = isFiniteNumber(args.dow)
    ? args.dow
    : now.getUTCDay();
  // Friday (UTC dow 5) is the weekly synthesis tier; Mon-Thu are exception probes.
  const tier = args.tier === "weekly" || args.tier === "exception_probe"
    ? args.tier
    : (dow === 5 ? "weekly" : "exception_probe");

  const decisionWord = decision.decision === "DRAFT" || decision.decision === "KEEP"
    ? decision.decision
    : "KEEP";

  const suppressed = suppressedMoveIds(decision);

  const signals = (Array.isArray(classification.material_signals)
    ? classification.material_signals
    : []).map((s) => ({
      signal_id: s.id,
      from: isFiniteNumber(s.from) ? s.from : null,
      to: isFiniteNumber(s.to) ? s.to : null,
      abs_delta: isFiniteNumber(s.abs_delta) ? s.abs_delta : null,
      exception_threshold: isFiniteNumber(s.exception_threshold) ? s.exception_threshold : null,
      threshold_basis: typeof s.threshold_basis === "string" ? s.threshold_basis : "default",
      is_material: !!s.is_material,
      in_suppressed_moves: !!suppressed[s.id]
    }));

  // routing_outcome may arrive as {exit_code, reason} (preferred) or a full object.
  let routing;
  const ro = args.routing_outcome || {};
  if (typeof ro.proceeded === "boolean") {
    routing = {
      proceeded: ro.proceeded,
      exit_code: isFiniteNumber(ro.exit_code) ? ro.exit_code : null,
      reason: typeof ro.reason === "string" ? ro.reason : ""
    };
  } else {
    routing = routingOutcomeFromExit(ro.exit_code, ro.reason);
  }

  return {
    schema_version: SCHEMA_VERSION,
    recorded_at: now.toISOString(),
    decision_date: typeof args.decision_date === "string" ? args.decision_date : null,
    dow,
    tier,
    decision: decisionWord,
    signals,
    routing_outcome: routing,
    downstream: null
  };
}

// appendEvidence — the ONLY side-effecting fn. Appends one JSON line to the
// ledger (creating it if absent). Returns the record. Newline-terminated so the
// file stays a valid JSONL stream.
function appendEvidence(record, opts) {
  opts = opts || {};
  const p = opts.path;
  if (!p) throw new Error("appendEvidence: opts.path is required");
  fs.appendFileSync(p, JSON.stringify(record) + "\n");
  return record;
}

// readLedger — parse a JSONL ledger into an array of records. Tolerant of blank
// lines and trailing newlines. Bad lines are skipped (never throws on one bad
// row). Pure read; returns [] when the file is absent.
function readLedger(p) {
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch (e) { return []; }
  const out = [];
  text.split("\n").forEach((line) => {
    const t = line.trim();
    if (!t) return;
    try { out.push(JSON.parse(t)); } catch (e) { /* skip malformed line */ }
  });
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  buildEvidenceRecord,
  appendEvidence,
  readLedger,
  // exported for tests / reuse:
  suppressedMoveIds,
  routingOutcomeFromExit
};
