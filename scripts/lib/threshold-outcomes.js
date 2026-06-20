"use strict";
/* =============================================================================
   threshold-outcomes.js — deterministic outcome-candidate labeling (dep-free)
   -----------------------------------------------------------------------------
   Phase A of the threshold-evolution loop (see threshold_evolution_spec.md A4).

   These are CANDIDATE labels, not verdicts. They are deterministic heuristics
   over the evidence ledger (automation/threshold-evidence.jsonl) that surface
   the two failure modes the user cares about:

     FALSE POSITIVE candidate
       An exception that PROCEEDED midweek (tier=exception_probe, is_material
       true) but whose downstream gate action was held_below_bar / held_safe, OR
       whose panel confidence was low. I.e. "we interrupted the week for little."
       When downstream is not yet filled, we cannot label an FP — we never guess.

     MISSED SIGNAL candidate
       A signal that was held for Friday (is_material false AND/OR appeared in
       suppressed_stale_moves) but whose move was a NEAR-MISS of its exception
       threshold (within a band below it), OR which RECURRED as material within
       the next few events. I.e. "we may have set the bar too high."

   The Phase B analyzer reasons over these aggregates; the AI never sees raw
   ledgers, only the prep these feed. Pure: no fs, no mutation, no side effects.
   ===========================================================================*/

// Downstream gate actions that mean "we proceeded but it wasn't worth it".
const WEAK_GATE_ACTIONS = ["held_below_bar", "held_safe"];
// Panel confidence at/under this is "thin" evidence the exception was worth it.
const DEFAULT_LOW_PANEL_CONF = 0.70;
// A held move within this fraction BELOW its threshold is a near-miss.
// (e.g. 0.15 => abs_delta in [0.85*threshold, threshold) counts as near-miss.)
const DEFAULT_NEAR_MISS_BAND = 0.15;
// How many subsequent events to scan for a recurrence-as-material.
const DEFAULT_RECURRENCE_WINDOW = 4;

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function asArray(x) { return Array.isArray(x) ? x : []; }

/**
 * falsePositiveCandidates — per-event FP candidates from the ledger (+ optional
 * runs for richer downstream signal). An event qualifies when an exception_probe
 * record PROCEEDED with >=1 material signal, AND its downstream shows a weak gate
 * action or low panel confidence. Records without downstream are skipped (we do
 * not invent outcomes).
 *
 * @param {Array} ledger  parsed evidence records
 * @param {Array} [runs]  optional run records (reserved; downstream is read off
 *                        the ledger record's `downstream` block when present)
 * @param {object} [opts] { low_panel_conf?: number }
 * @returns {Array<{recorded_at, decision_date, signal_ids, gate_action,
 *                  panel_min_confidence, reasons[]}>}
 */
function falsePositiveCandidates(ledger, runs, opts) {
  opts = opts || {};
  const lowConf = isFiniteNumber(opts.low_panel_conf) ? opts.low_panel_conf : DEFAULT_LOW_PANEL_CONF;
  const out = [];

  asArray(ledger).forEach((rec) => {
    if (!rec || rec.tier !== "exception_probe") return;
    const ro = rec.routing_outcome || {};
    if (!ro.proceeded) return;
    const materialIds = asArray(rec.signals).filter((s) => s && s.is_material).map((s) => s.signal_id);
    if (materialIds.length === 0) return;

    const ds = rec.downstream;
    if (!ds || typeof ds !== "object") return; // outcome unknown — cannot label FP

    const reasons = [];
    if (typeof ds.gate_action === "string" && WEAK_GATE_ACTIONS.indexOf(ds.gate_action) !== -1) {
      reasons.push("proceeded midweek but gate action was " + ds.gate_action);
    }
    if (isFiniteNumber(ds.panel_min_confidence) && ds.panel_min_confidence <= lowConf) {
      reasons.push("panel min confidence " + ds.panel_min_confidence + " <= " + lowConf + " (thin)");
    }
    if (reasons.length === 0) return;

    out.push({
      recorded_at: rec.recorded_at || null,
      decision_date: rec.decision_date || null,
      signal_ids: materialIds,
      gate_action: ds.gate_action || null,
      panel_min_confidence: isFiniteNumber(ds.panel_min_confidence) ? ds.panel_min_confidence : null,
      reasons
    });
  });

  return out;
}

/**
 * missedSignalCandidates — per-signal aggregates of "held but probably mattered"
 * events. For each non-material held appearance we check two deterministic cues:
 *   (a) near-miss: abs_delta within `near_miss_band` BELOW the threshold, and
 *   (b) recurrence: the same signal appears as is_material true within the next
 *       `recurrence_window` events of the ledger.
 * Either cue flags the held event as a missed-signal candidate.
 *
 * @param {Array} ledger  parsed evidence records (chronological order assumed)
 * @param {object} [opts] { near_miss_band?, recurrence_window? }
 * @returns {Array<{signal_id, held_count, near_miss_count, recurrence_count,
 *                  missed_candidate_count, events[]}>}  sorted by signal_id
 */
function missedSignalCandidates(ledger, opts) {
  opts = opts || {};
  const band = isFiniteNumber(opts.near_miss_band) ? opts.near_miss_band : DEFAULT_NEAR_MISS_BAND;
  const win = isFiniteNumber(opts.recurrence_window) ? opts.recurrence_window : DEFAULT_RECURRENCE_WINDOW;
  const recs = asArray(ledger);

  // Flatten to per-signal appearances with their record index for recurrence scan.
  const appearances = []; // { idx, signal_id, s, rec }
  recs.forEach((rec, idx) => {
    asArray(rec && rec.signals).forEach((s) => {
      if (s && s.signal_id) appearances.push({ idx, signal_id: s.signal_id, s: s, rec: rec });
    });
  });

  const agg = {}; // signal_id -> aggregate
  function bucket(id) {
    if (!agg[id]) {
      agg[id] = {
        signal_id: id, held_count: 0, near_miss_count: 0,
        recurrence_count: 0, missed_candidate_count: 0, events: []
      };
    }
    return agg[id];
  }

  appearances.forEach((ap) => {
    const s = ap.s;
    // A "held" appearance: not material, OR explicitly in suppressed moves.
    const held = s.is_material === false || s.in_suppressed_moves === true;
    if (!held) return;

    const b = bucket(ap.signal_id);
    b.held_count += 1;

    const cues = [];

    // (a) near-miss against the resolved threshold at the time.
    if (isFiniteNumber(s.abs_delta) && isFiniteNumber(s.exception_threshold) && s.exception_threshold > 0) {
      const lo = s.exception_threshold * (1 - band);
      if (s.abs_delta >= lo && s.abs_delta < s.exception_threshold) {
        b.near_miss_count += 1;
        cues.push("near_miss(abs_delta " + s.abs_delta + " in [" + lo + ", " + s.exception_threshold + "))");
      }
    }

    // (b) recurrence-as-material within the next `win` records.
    let recurs = false;
    for (let j = ap.idx + 1; j < recs.length && j <= ap.idx + win; j++) {
      const later = recs[j];
      const hit = asArray(later && later.signals).some(
        (ls) => ls && ls.signal_id === ap.signal_id && ls.is_material === true
      );
      if (hit) { recurs = true; break; }
    }
    if (recurs) {
      b.recurrence_count += 1;
      cues.push("recurred_material_within_" + win + "_events");
    }

    if (cues.length > 0) {
      b.missed_candidate_count += 1;
      b.events.push({
        recorded_at: ap.rec.recorded_at || null,
        decision_date: ap.rec.decision_date || null,
        abs_delta: isFiniteNumber(s.abs_delta) ? s.abs_delta : null,
        exception_threshold: isFiniteNumber(s.exception_threshold) ? s.exception_threshold : null,
        cues
      });
    }
  });

  return Object.keys(agg).sort().map((k) => agg[k]);
}

/**
 * perSignalStats — deterministic counts used by both the summary and the Phase B
 * analyzer: times_seen, times_material (fired), times_suppressed, fire_rate.
 * Pure. Returns a map signal_id -> stats.
 */
function perSignalStats(ledger) {
  const map = {};
  asArray(ledger).forEach((rec) => {
    asArray(rec && rec.signals).forEach((s) => {
      if (!s || !s.signal_id) return;
      const id = s.signal_id;
      if (!map[id]) map[id] = { signal_id: id, times_seen: 0, times_material: 0, times_suppressed: 0, fire_rate: 0 };
      map[id].times_seen += 1;
      if (s.is_material === true) map[id].times_material += 1;
      if (s.in_suppressed_moves === true) map[id].times_suppressed += 1;
    });
  });
  Object.keys(map).forEach((id) => {
    const m = map[id];
    m.fire_rate = m.times_seen > 0 ? m.times_material / m.times_seen : 0;
  });
  return map;
}

module.exports = {
  falsePositiveCandidates,
  missedSignalCandidates,
  perSignalStats,
  WEAK_GATE_ACTIONS,
  DEFAULT_LOW_PANEL_CONF,
  DEFAULT_NEAR_MISS_BAND,
  DEFAULT_RECURRENCE_WINDOW
};
