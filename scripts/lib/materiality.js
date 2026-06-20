#!/usr/bin/env node
/* =============================================================================
   materiality.js — deterministic editorial-materiality classifier (dep-free)
   -----------------------------------------------------------------------------
   Pulse runs on a THREE-TIER cadence:
     1. Daily detection (weekday refresh + decision engine) — unchanged.
     2. Weekly synthesis — full research→editorial→panel→publish every Friday.
        Publishes on ANY DRAFT.
     3. Gated exception — Mon–Thu, publish OFF-cycle ONLY when a genuine
        `material_data_move` clears a conservative editorial-materiality
        threshold. Narrative- or staleness-only DRAFTs WAIT for Friday.

   This module answers ONE question for tier 3: does the latest decision contain
   a data move big enough to justify breaking the weekly cadence midweek?

   CRITICAL DISTINCTION (see exception_routing_spec.md):
   The registry `thresholds.max_abs_step` / `max_pct_step` are DATA-VALIDATION /
   OUTLIER bounds — "this jump is implausible, send it to needs_review". They are
   far too large to mean "this is worth publishing midweek" (e.g. cpi
   max_abs_step=2.5 pp). We therefore DO NOT reuse them as the exception trigger.
   The editorial-exception threshold is a SEPARATE, conservative bound, resolved
   per signal as:
     1. registry signal's explicit OPTIONAL `exception_threshold` field, or
     2. a conservative fraction (default 0.35) of the validation `max_abs_step`, or
     3. a pct-based fraction derived from `max_pct_step` when no abs step exists, or
     4. nothing resolvable -> NOT material (conservative: caught Friday anyway).

   Hard rule: this module NEVER mutates inputs, never touches the network or fs.
   Pure read -> verdict. The caller passes data in.
   ===========================================================================*/
"use strict";

const DEFAULT_DERIVED_FRACTION = 0.35;

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Build an id -> registry-entry map. The registry stores signals under
// `signals[]` keyed by `signal_id` (matching emit-editorial-task.js).
function registryById(registry) {
  const map = {};
  const list = registry && Array.isArray(registry.signals) ? registry.signals : [];
  list.forEach((e) => { if (e && e.signal_id) map[e.signal_id] = e; });
  return map;
}

// Resolve the absolute delta for a moved signal. Prefer the explicit `delta`
// carried on the trigger; otherwise derive it from to-from when both are numeric.
// Returns null when no usable magnitude can be determined.
function resolveAbsDelta(mv) {
  if (isFiniteNumber(mv.delta)) return Math.abs(mv.delta);
  if (isFiniteNumber(mv.to) && isFiniteNumber(mv.from)) return Math.abs(mv.to - mv.from);
  return null;
}

// Resolve the editorial-exception threshold for ONE moved signal.
// Returns { exception_threshold, threshold_basis, is_material, reason } given the
// signal's resolved absolute delta. `is_material` is computed here only when the
// basis is a value-space threshold; the pct path computes it inline (it needs
// `from`). Pure — reads the registry entry, never writes.
function resolveThreshold(mv, regEntry, absDelta, fraction) {
  const th = (regEntry && regEntry.thresholds) || {};

  // 1) explicit optional registry field (signal's own unit) — highest priority.
  if (isFiniteNumber(th.exception_threshold)) {
    const t = Math.abs(th.exception_threshold);
    return {
      exception_threshold: t,
      threshold_basis: "registry.exception_threshold",
      is_material: absDelta != null && absDelta >= t,
      reason: absDelta == null
        ? "no_usable_delta"
        : (absDelta >= t
            ? "abs_delta " + absDelta + " >= exception_threshold " + t
            : "abs_delta " + absDelta + " < exception_threshold " + t)
    };
  }

  // 2) conservative fraction of the validation max_abs_step (value space).
  if (isFiniteNumber(th.max_abs_step)) {
    const t = Math.abs(th.max_abs_step) * fraction;
    return {
      exception_threshold: t,
      threshold_basis: "derived_fraction",
      is_material: absDelta != null && absDelta >= t,
      reason: absDelta == null
        ? "no_usable_delta"
        : (absDelta >= t
            ? "abs_delta " + absDelta + " >= " + fraction + "*max_abs_step (" + t + ")"
            : "abs_delta " + absDelta + " < " + fraction + "*max_abs_step (" + t + ")")
    };
  }

  // 3) pct path: derive from max_pct_step when no abs step exists. Material if
  //    abs(delta)/abs(from)*100 >= max_pct_step * fraction. Needs a nonzero from.
  if (isFiniteNumber(th.max_pct_step)) {
    const pctTrigger = Math.abs(th.max_pct_step) * fraction; // in percent points
    if (absDelta != null && isFiniteNumber(mv.from) && mv.from !== 0) {
      const movePct = (absDelta / Math.abs(mv.from)) * 100;
      return {
        exception_threshold: pctTrigger,
        threshold_basis: "derived_fraction(pct)",
        is_material: movePct >= pctTrigger,
        reason: (movePct >= pctTrigger
          ? "move " + movePct.toFixed(4) + "% >= " + fraction + "*max_pct_step (" + pctTrigger + "%)"
          : "move " + movePct.toFixed(4) + "% < " + fraction + "*max_pct_step (" + pctTrigger + "%)")
      };
    }
    // Can't compute a percentage without a nonzero base -> not material.
    return {
      exception_threshold: pctTrigger,
      threshold_basis: "derived_fraction(pct)",
      is_material: false,
      reason: "no_pct_base (from missing or zero)"
    };
  }

  // 4) nothing resolvable -> conservative: not material; Friday will catch it.
  return {
    exception_threshold: null,
    threshold_basis: "default",
    is_material: false,
    reason: "no_threshold_basis"
  };
}

/**
 * classifyMateriality — pure verdict on whether a decision warrants a midweek
 * (tier 3) exception publish.
 *
 * @param {object} decision  parsed pulse-editorial-decision.json
 * @param {object} registry  parsed signals_registry.json
 * @param {object} [opts]    { derived_fraction?: number, now?: Date }
 * @returns {object} see exception_routing_spec.md DELIVERABLE 1.
 */
function classifyMateriality(decision, registry, opts) {
  opts = opts || {};
  const fraction = isFiniteNumber(opts.derived_fraction) ? opts.derived_fraction : DEFAULT_DERIVED_FRACTION;
  const now = opts.now instanceof Date ? opts.now : new Date();

  const rMap = registryById(registry);
  const triggers = decision && Array.isArray(decision.triggers) ? decision.triggers : [];
  const isDraft = !!decision && decision.decision === "DRAFT";

  const material_signals = [];
  let has_material_move = false;

  triggers.forEach((t) => {
    if (!t || t.type !== "material_data_move" || !Array.isArray(t.signals)) return;
    has_material_move = true;
    t.signals.forEach((s) => {
      if (!s || !s.id) return;
      const mv = {
        id: s.id,
        from: isFiniteNumber(s.from) ? s.from : null,
        to: isFiniteNumber(s.to) ? s.to : null,
        delta: isFiniteNumber(s.delta) ? s.delta : null
      };
      const absDelta = resolveAbsDelta(mv);
      const r = resolveThreshold(mv, rMap[s.id], absDelta, fraction);
      material_signals.push({
        id: mv.id,
        from: mv.from,
        to: mv.to,
        delta: mv.delta,
        abs_delta: absDelta,
        exception_threshold: r.exception_threshold,
        threshold_basis: r.threshold_basis,
        is_material: !!r.is_material,
        reason: r.reason
      });
    });
  });

  const any_material = material_signals.some((m) => m.is_material);
  // A DRAFT that has NO material move at all is narrative/staleness-only and must
  // WAIT for Friday. (KEEP decisions are not DRAFTs and never WAIT — nothing to do.)
  const narrative_or_staleness_only = isDraft && !has_material_move;

  return {
    has_material_move,
    material_signals,
    any_material,
    narrative_or_staleness_only,
    classified_at: now.toISOString()
  };
}

module.exports = {
  classifyMateriality,
  // exported for unit tests / reuse:
  resolveThreshold,
  resolveAbsDelta,
  registryById,
  DEFAULT_DERIVED_FRACTION
};
