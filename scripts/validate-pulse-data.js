#!/usr/bin/env node
/* =====================================================================
   validate-pulse-data.js  —  Pulse trust validation + review report (Pass D)
   ---------------------------------------------------------------------
   Dependency-free (Node standard library only).

   What it does:
     1. Loads data/signals_registry.json and data/pulse-content.json.
     2. Validates every signal's CURRENT stored state against the registry
        (range, date validity, cadence/staleness, unit, source mapping).
     3. Runs editorial-alignment checks (data direction vs editorial stance)
        and writes status / alignment_status / review_required metadata back
        onto each signal in pulse-content.json (additive, non-breaking).
     4. Computes editorial freshness for the Weekly Connection and per-signal
        thesis blocks.
     5. Writes data/pulse-review-report.json summarising updated / unchanged /
        stale / failed / needs_review / alignment_mismatches with reasons,
        timestamps and sources.

   Modes (exact contract):
     node scripts/validate-pulse-data.js            # DEFAULT: validate + apply
                                                    # additive metadata + write
                                                    # pulse-review-report.json.
                                                    # Local / separate apply job.
     node scripts/validate-pulse-data.js --dry-run  # validate only. No writes.
                                                    # No failure exit code.
     node scripts/validate-pulse-data.js --check    # validate only. No writes.
                                                    # Exit 1 on any hard failure.
                                                    # THIS IS THE CI GATE.

   Write/exit matrix:
     mode        writes files?   exits non-zero on hard failure?
     default     yes             no (applies; integrity abort exits 2)
     --dry-run   no              no
     --check     no              yes (exit 1)

   --check is strictly read-only: it conflates nothing with metadata
   application, so the gate's behavior never depends on filesystem state.

   IMPORTANT: This script is conservative. It NEVER deletes signals, never
   reduces the signal count, and never overwrites current_value with a worse
   value. It only adds machine-readable trust metadata. If you also wire a
   fetcher, that fetcher uses scripts/lib/pulse-trust.js applyVerdict() to
   protect last-known-good values before this report runs.
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const trust = require("./lib/pulse-trust.js");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "data", "signals_registry.json");
const CONTENT_PATH = path.join(ROOT, "data", "pulse-content.json");
const REPORT_PATH = path.join(ROOT, "data", "pulse-review-report.json");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CHECK = args.includes("--check");
// Only the DEFAULT mode is allowed to write. Both --dry-run and --check are
// strictly read-only. --check is the CI gate and must never mutate the tree.
const WRITE = !DRY_RUN && !CHECK;

function load(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

function main() {
  const now = new Date();
  const registry = load(REGISTRY_PATH);
  const content = load(CONTENT_PATH);

  const beforeCount = (content.signals || []).length;

  const report = {
    generated_at: now.toISOString(),
    registry_version: registry.schema_version,
    signal_count: beforeCount,
    summary: {
      verified: 0, stale: 0, needs_review: 0, failed: 0, manual: 0,
      alignment_mismatches: 0, updated: 0, unchanged: 0
    },
    signals: [],
    alignment_mismatches: [],
    failures: [],
    needs_review: [],
    editorial: {}
  };

  (content.signals || []).forEach((signal) => {
    const entry = trust.getRegistryEntry(registry, signal.id);

    // --- validate the CURRENT stored state as a "candidate" against itself ---
    // This surfaces stale / out-of-range / bad-date conditions on live data.
    const candidate = {
      signal_id: signal.id,
      value: signal.current_value,
      date: signal.last_updated,
      unit: signal.current_unit,
      source_series: entry ? entry.source_series : null
    };
    // prev = same stored value, so step/pct guards are no-ops here; the point
    // is range/date/cadence validation of what is already published.
    const prev = { value: signal.current_value, last_updated: signal.last_updated, unit: signal.current_unit };
    const verdict = trust.validateSignalUpdate(registry, candidate, prev, { now });

    // --- editorial alignment ---
    const align = trust.checkEditorialAlignment(registry, signal, entry);

    // --- write additive metadata back onto the signal ---
    const prevTrustStatus = signal.trust && signal.trust.status;
    signal.status_meta = {
      status: verdict.status,                 // verified|stale|needs_review|failed|manual
      checked_at: now.toISOString(),
      reason: verdict.reason,
      status_type: entry ? entry.status_type : "automated"
    };
    signal.alignment_status = align.alignment_status;   // aligned|mismatch|unknown
    signal.review_required = !!align.review_required ||
      verdict.status === "needs_review" || verdict.status === "failed";

    // per-signal editorial thesis freshness
    const thesisReviewed = signal.last_editorial_reviewed || signal.last_updated || null;
    const thesisExp = registry.editorial_freshness_policy.per_signal_thesis_expires_after_days;
    const ef = trust.editorialFreshness(thesisReviewed, thesisExp, now);
    signal.editorial_freshness = {
      last_editorial_reviewed: thesisReviewed,
      expires_after_days: thesisExp,
      editorial_status: ef.editorial_status,
      age_days: ef.age_days
    };
    // If data moved materially AND alignment mismatched, force thesis review.
    if (align.alignment_status === "mismatch") {
      signal.editorial_freshness.editorial_status = "stale";
      signal.editorial_freshness.needs_thesis_review = true;
    }

    // --- tally ---
    report.summary[verdict.status] = (report.summary[verdict.status] || 0) + 1;
    if (align.alignment_status === "mismatch") {
      report.summary.alignment_mismatches++;
      report.alignment_mismatches.push({
        signal_id: signal.id, detail: align.detail,
        data_direction: align.data_direction, editorial_stance: align.editorial_stance
      });
    }
    if (verdict.status === "failed") {
      report.failures.push({ signal_id: signal.id, reason: verdict.reason,
        failed_checks: verdict.failures, at: now.toISOString() });
    }
    if (verdict.status === "needs_review") {
      report.needs_review.push({ signal_id: signal.id, reason: verdict.reason, at: now.toISOString() });
    }

    // updated vs unchanged is meaningful when a fetcher ran; here, treat a
    // changed trust status from a prior run as "updated".
    if (prevTrustStatus && prevTrustStatus !== verdict.status) report.summary.updated++;
    else report.summary.unchanged++;

    report.signals.push({
      signal_id: signal.id,
      name: entry ? entry.name : signal.title,
      category: signal.category,
      status: verdict.status,
      alignment_status: align.alignment_status,
      review_required: signal.review_required,
      current_value: signal.current_value,
      last_updated: signal.last_updated,
      editorial_status: signal.editorial_freshness.editorial_status,
      reason: verdict.reason,
      sources: (signal.sources || []).map((s) => ({ name: s.name, url: s.url, tier: s.tier })),
      checked_at: now.toISOString()
    });
  });

  // --- Weekly Connection editorial freshness ---
  const wc = content.weekly_connection;
  if (wc) {
    const wcReviewed = wc.last_editorial_reviewed || wc.date || null;
    const wcExp = registry.editorial_freshness_policy.weekly_connection_expires_after_days;
    const ef = trust.editorialFreshness(wcReviewed, wcExp, now);
    wc.editorial_freshness = {
      last_editorial_reviewed: wcReviewed,
      expires_after_days: wcExp,
      editorial_status: ef.editorial_status,
      age_days: ef.age_days
    };
    // If any connected signal is in mismatch, Weekly Connection needs review.
    const connected = wc.connected_signals || [];
    const mismatchedConnected = connected.filter((id) => {
      const s = (content.signals || []).find((x) => x.id === id);
      return s && s.alignment_status === "mismatch";
    });
    wc.review_required = ef.editorial_status === "stale" || mismatchedConnected.length > 0;
    wc.review_note = wc.review_required
      ? (mismatchedConnected.length
          ? "Connected signal(s) moved against the interpretation: " + mismatchedConnected.join(", ")
          : "Weekly Connection is older than " + wcExp + " days")
      : "";
    report.editorial.weekly_connection = {
      editorial_status: ef.editorial_status,
      age_days: ef.age_days,
      review_required: wc.review_required,
      review_note: wc.review_note,
      mismatched_connected_signals: mismatchedConnected
    };
  }

  // --- integrity guard: never reduce signal count ---
  const afterCount = (content.signals || []).length;
  report.integrity = {
    signal_count_before: beforeCount,
    signal_count_after: afterCount,
    count_preserved: beforeCount === afterCount && afterCount === 18,
    has_mfg_activity: !!(content.signals || []).find((s) => s.id === "mfg-activity"),
    has_services_activity: !!(content.signals || []).find((s) => s.id === "services-activity")
  };

  // --- write outputs (DEFAULT mode only; --dry-run and --check never write) ---
  if (WRITE) {
    if (afterCount !== beforeCount || afterCount !== 18) {
      console.error("ABORT: signal count integrity check failed (" +
        beforeCount + " -> " + afterCount + "). No files written.");
      process.exit(2);
    }
    fs.writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2) + "\n", "utf8");
    console.log("Updated " + CONTENT_PATH + " (additive trust metadata)");
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log("Wrote " + REPORT_PATH);
  } else if (DRY_RUN) {
    console.log("DRY RUN — no files written. Report preview:");
  } else if (CHECK) {
    console.log("CHECK — read-only CI gate. No files written.");
  }

  // console summary
  const s = report.summary;
  console.log("\nPulse trust summary:");
  console.log("  verified=" + s.verified + " stale=" + s.stale +
    " needs_review=" + s.needs_review + " failed=" + s.failed + " manual=" + s.manual);
  console.log("  alignment_mismatches=" + s.alignment_mismatches);
  console.log("  integrity: 18 signals=" + report.integrity.count_preserved +
    " mfg=" + report.integrity.has_mfg_activity +
    " services=" + report.integrity.has_services_activity);

  if (DRY_RUN) {
    // print compact report to stdout in dry-run
    console.log(JSON.stringify({ summary: report.summary, integrity: report.integrity,
      alignment_mismatches: report.alignment_mismatches, failures: report.failures,
      needs_review: report.needs_review }, null, 2));
  }

  // --check is the CI gate: exit 1 on any hard failure so the commit step that
  // follows in the workflow never runs and the previous good pulse-content.json
  // stays on main. --dry-run never sets a failure exit code.
  if (CHECK && (s.failed > 0)) {
    console.error("\nCHECK MODE: hard failures present — exiting 1");
    process.exit(1);
  }
}

main();
