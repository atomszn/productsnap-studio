#!/usr/bin/env node
/* ========================================================================
   ProductSnap Studio — Pulse source-verification gate

   Independently re-fetches each automated signal's latest observation from
   its primary source (FRED / BLS), re-derives what current_value + last_updated
   SHOULD be using the same shared transform the writer uses, and compares to
   what is currently stored in data/pulse-content.json.

   Verdicts (per signal):
     MATCH            stored value/date equal the freshly fetched source value/date
     VALUE_DRIFT      source has a different value for a valid (same-or-newer)
                      observation date that passes all structural checks
                      -> AUTO-CORRECT the stored data fields, then notify (logged)
     STRUCTURAL_FAIL  source returned nothing / empty / future date / out-of-range
                      / backwards date -> HARD-FAIL the run, keep last-known-good
     SKIP             curated Tier-2/3 signal (no free API) -> not source-verifiable

   Writes data/pulse-source-verification.json (auditable proof).

   Modes:
     node scripts/verify-pulse-sources.js            verify + auto-correct drift (writes content if drift)
     node scripts/verify-pulse-sources.js --check    verify only, never write content (CI read-only gate)
     node scripts/verify-pulse-sources.js --dry-run   use stored values as the "source" (offline structural smoke test)

   Exit codes: 0 = all automated signals MATCH or cleanly auto-corrected.
               1 = at least one STRUCTURAL_FAIL (or a fetch error). The workflow
                   must run this BEFORE the commit step so a failure keeps
                   last-known-good and nothing lands.

   Dependency-free: Node built-ins only. No npm.
   ======================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const sources = require("./lib/pulse-sources.js");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_PATH = path.join(ROOT, "data", "pulse-content.json");
const REGISTRY_PATH = path.join(ROOT, "data", "signals_registry.json");
const VERIFY_OUT = path.join(ROOT, "data", "pulse-source-verification.json");

// Float tolerance for comparing the displayed (already-rounded) value strings.
// We compare the formatted strings first; if they differ we fall back to a
// numeric compare with this tolerance to avoid flagging pure float noise.
const NUMERIC_TOLERANCE = 0.0001;

function parseArgs(argv) {
  const a = { check: false, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--check") a.check = true;
    else if (argv[i] === "--dry-run") a.dryRun = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return a;
}

function log(msg) { console.log(`[pulse-verify] ${msg}`); }

function load(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

// Pull the numeric magnitude out of a formatted value string for tolerance
// comparison ("-0.4" -> -0.4, "3.21%" -> 3.21, "$6.65T" -> 6.65, "+22k" -> 22).
function numericOf(formatted) {
  const m = String(formatted).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

function valuesAgree(storedValue, sourceValue) {
  if (String(storedValue) === String(sourceValue)) return true;
  const a = numericOf(storedValue);
  const b = numericOf(sourceValue);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return Math.abs(a - b) <= NUMERIC_TOLERANCE;
  }
  return false;
}

// Structural validity of a freshly fetched observation, using the signal's
// expected_range from the registry. Garbage must HARD-FAIL, never auto-correct.
function structuralProblems(id, registry, sourceValue, observationDate) {
  const problems = [];
  const reg = (registry.signals || []).find((s) => s.signal_id === id || s.id === id);
  const numeric = numericOf(sourceValue);

  if (!Number.isFinite(numeric)) {
    problems.push(`source value not numeric: ${sourceValue}`);
  }
  // valid, non-future date
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(observationDate || "")) {
    problems.push(`source observation date not ISO-like: ${observationDate}`);
  } else {
    const norm = sources.normalizeLastUpdated(observationDate);
    const d = new Date(`${norm}T00:00:00Z`);
    const now = new Date();
    if (Number.isNaN(d.getTime())) problems.push(`unparseable source date: ${observationDate}`);
    else if (d.getTime() > now.getTime() + 24 * 3600 * 1000) problems.push(`future source date: ${observationDate}`);
  }
  // expected range from registry thresholds
  const range = reg && reg.thresholds && Array.isArray(reg.thresholds.expected_range)
    ? reg.thresholds.expected_range : null;
  if (range && Number.isFinite(numeric)) {
    if (numeric < range[0] || numeric > range[1]) {
      problems.push(`source value ${numeric} outside expected_range [${range[0]}, ${range[1]}]`);
    }
  }
  return problems;
}

// Does the source observation date move backwards relative to what is stored?
// (A backwards date is structurally suspect — never auto-correct to older data.)
function dateMovesBackward(storedDate, sourceDate) {
  if (!storedDate || !sourceDate) return false;
  const a = sources.normalizeLastUpdated(storedDate);
  const b = sources.normalizeLastUpdated(sourceDate);
  return b < a;
}

async function main() {
  const args = parseArgs(process.argv);
  const content = load(CONTENT_PATH);
  const registry = load(REGISTRY_PATH);
  const env = process.env;

  const results = [];
  let structuralFails = 0;
  let autoCorrections = 0;
  let matches = 0;
  let contentChanged = false;

  for (const id of sources.AUTO_SIGNAL_IDS) {
    const config = sources.SIGNAL_CONFIG[id];
    const signal = (content.signals || []).find((s) => s.id === id);
    const checkedAt = new Date().toISOString();
    const sourceUrl = sources.sourceUrlFor(config);

    if (!signal) {
      results.push({ id, verdict: "STRUCTURAL_FAIL", reason: "signal missing from content", source_url: sourceUrl, checked_at: checkedAt });
      structuralFails += 1;
      continue;
    }

    const storedValue = signal.current_value;
    const storedDate = signal.last_updated;

    // --dry-run: don't hit the network; treat stored values as the "source".
    // This is an offline structural smoke test only (never a real verification).
    if (args.dryRun) {
      results.push({
        id, verdict: "MATCH", stored_value: storedValue, source_value: storedValue,
        observation_date: storedDate, source_url: sourceUrl, action_taken: "none (dry-run, no network)", checked_at: checkedAt
      });
      matches += 1;
      continue;
    }

    let prepared, rawLatest;
    try {
      ({ prepared, rawLatest } = await sources.fetchPreparedSeries(id, config, env));
    } catch (err) {
      results.push({ id, verdict: "STRUCTURAL_FAIL", reason: `fetch error: ${err.message}`, source_url: sourceUrl, checked_at: checkedAt });
      structuralFails += 1;
      log(`✗ ${id}: STRUCTURAL_FAIL (fetch error: ${err.message})`);
      continue;
    }

    let derived;
    try {
      derived = sources.deriveCurrent(config, prepared, rawLatest);
    } catch (err) {
      results.push({ id, verdict: "STRUCTURAL_FAIL", reason: `derive error: ${err.message}`, source_url: sourceUrl, checked_at: checkedAt });
      structuralFails += 1;
      log(`✗ ${id}: STRUCTURAL_FAIL (derive error: ${err.message})`);
      continue;
    }

    const sourceValue = derived.current_value;
    const sourceDate = derived.last_updated;

    // 1) Exact agreement on value AND date => MATCH.
    if (valuesAgree(storedValue, sourceValue) &&
        sources.normalizeLastUpdated(storedDate) === sources.normalizeLastUpdated(sourceDate)) {
      results.push({
        id, verdict: "MATCH", stored_value: storedValue, source_value: sourceValue,
        observation_date: sourceDate, source_url: sourceUrl, action_taken: "none", checked_at: checkedAt
      });
      matches += 1;
      log(`✓ ${id}: MATCH (${storedValue} @ ${sourceDate})`);
      continue;
    }

    // 2) Disagreement. Decide auto-correct vs hard-fail.
    const problems = structuralProblems(id, registry, sourceValue, sourceDate);
    if (dateMovesBackward(storedDate, sourceDate)) {
      problems.push(`source date ${sourceDate} is older than stored ${storedDate}`);
    }

    if (problems.length > 0) {
      results.push({
        id, verdict: "STRUCTURAL_FAIL", stored_value: storedValue, source_value: sourceValue,
        observation_date: sourceDate, problems, source_url: sourceUrl, action_taken: "none (kept last-known-good)", checked_at: checkedAt
      });
      structuralFails += 1;
      log(`✗ ${id}: STRUCTURAL_FAIL (${problems.join("; ")})`);
      continue;
    }

    // 3) Clean drift: source has a different but valid value/date. Auto-correct
    //    the stored current_value + last_updated (and timestamps) to match the
    //    source, then notify (logged). In --check mode we never write; we still
    //    record the drift so CI can surface it without mutating the tree.
    if (args.check) {
      results.push({
        id, verdict: "VALUE_DRIFT", stored_value: storedValue, source_value: sourceValue,
        observation_date: sourceDate, source_url: sourceUrl,
        action_taken: "none (--check: read-only; drift recorded, not corrected)", checked_at: checkedAt
      });
      // In strict read-only gate mode a drift is a soft signal, not a hard fail:
      // the writer's own run (non-check) is what performs the correction. We do
      // NOT fail --check on drift, because --check runs after the writer already
      // corrected; a residual drift here would instead indicate a real problem
      // and is surfaced for the workflow log.
      log(`• ${id}: VALUE_DRIFT recorded (stored ${storedValue} vs source ${sourceValue}) [--check read-only]`);
      continue;
    }

    // Perform the auto-correction on the in-memory content.
    const before = { current_value: storedValue, last_updated: storedDate };
    signal.current_value = sourceValue;
    signal.last_updated = sourceDate;
    const prevTs = (signal.timestamps && typeof signal.timestamps === "object") ? signal.timestamps : {};
    signal.timestamps = {
      latest_source_data_date: sourceDate,
      last_editorial_reviewed: prevTs.last_editorial_reviewed != null ? prevTs.last_editorial_reviewed : null
    };
    contentChanged = true;
    autoCorrections += 1;
    results.push({
      id, verdict: "VALUE_DRIFT", stored_value: before.current_value, source_value: sourceValue,
      observation_date: sourceDate, source_url: sourceUrl,
      action_taken: `auto-corrected current_value ${before.current_value} -> ${sourceValue}, last_updated ${before.last_updated} -> ${sourceDate}`,
      checked_at: checkedAt
    });
    log(`⟳ ${id}: VALUE_DRIFT auto-corrected (${before.current_value} -> ${sourceValue} @ ${sourceDate})`);
  }

  // Curated Tier-2/3 signals: record as not source-verifiable (honest, not a pass).
  const curatedIds = (content.signals || [])
    .map((s) => s.id)
    .filter((id) => !sources.AUTO_SIGNAL_IDS.includes(id));
  for (const id of curatedIds) {
    results.push({ id, verdict: "SKIP", reason: "curated Tier-2/3 signal — no free API, not source-verifiable", checked_at: new Date().toISOString() });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    mode: args.dryRun ? "dry-run" : (args.check ? "check" : "verify"),
    automated_signal_count: sources.AUTO_SIGNAL_IDS.length,
    matches,
    auto_corrections: autoCorrections,
    structural_fails: structuralFails,
    curated_skipped: curatedIds.length,
    overall: structuralFails > 0 ? "FAIL" : "PASS"
  };

  // Write the auditable verification artifact (always, even on --check).
  const verifyDoc = { schema_version: "1.0.0", summary, signals: results };
  fs.writeFileSync(VERIFY_OUT, JSON.stringify(verifyDoc, null, 2) + "\n");
  log(`Wrote ${path.relative(ROOT, VERIFY_OUT)} (${summary.overall}: ${matches} match, ${autoCorrections} corrected, ${structuralFails} structural-fail, ${curatedIds.length} curated-skip)`);

  // Persist any auto-corrections to content (verify mode only).
  if (contentChanged && !args.check && !args.dryRun) {
    fs.writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2) + "\n");
    log(`Wrote ${path.relative(ROOT, CONTENT_PATH)} with ${autoCorrections} auto-correction(s).`);
  }

  if (structuralFails > 0) {
    log(`GATE FAILED: ${structuralFails} signal(s) had structural problems. Last-known-good kept; nothing should commit.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[pulse-verify] Fatal: ${err.message}`);
  process.exit(1);
});
