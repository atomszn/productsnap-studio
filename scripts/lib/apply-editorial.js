"use strict";
/* =============================================================================
   apply-editorial.js — apply a content-draft onto pulse-content, with an
   EDITORIAL-ONLY DIFF GUARD                                       (Phase 2)
   -----------------------------------------------------------------------------
   Dependency-free (Node standard library only). Pure functions: no network, no
   process.exit, no file writes. Two responsibilities:

     applyDraft(liveContent, draft, opts)
        Returns a NEW content object with the draft's editorial PROSE written in.
        It only ever sets fields named in editable-fields-map.md. Data fields
        (current_value, data_points, compared_to, percentile, sources,
        last_updated, ...) are copied through untouched. Also stamps the editorial
        freshness bookkeeping (last_editorial_reviewed, alignment_status,
        review_required) so the downstream data-validate recompute agrees.

     diffGuard(before, after)
        Walks the two content objects and asserts ONLY editable paths changed.
        If ANY read-only data path differs, returns ok:false with the offending
        paths. This is the structural backstop: even if applyDraft had a bug, the
        guard refuses to let a data value reach the page.

   The runner calls applyDraft, then diffGuard(before, after); a failed guard is a
   hard RED and nothing is written.
   ===========================================================================*/

// Read-only data paths that must NEVER change via the editorial path. Checked per
// signal (by id) and at the content top level. Matches editable-fields-map.md.
// NOTE on why_we_think_this: as of Phase 3 the PROSE subfields
// (reasoning, counterarguments, what_would_make_us_wrong) are EDITABLE so the
// macro-editor can clear jargon there. The machine subfield `signals_used` stays
// read-only and is guarded separately (WHY_WE_THINK_READONLY_SUBKEYS) so the
// diff guard still catches a data-list change. why_we_think_this is therefore NOT
// in SIGNAL_READONLY_KEYS anymore.
const SIGNAL_READONLY_KEYS = [
  "id", "category", "category_label",
  "current_value", "current_unit", "data_points", "compared_to", "percentile",
  "confidence", "tier", "last_updated", "sources", "source_note",
  "term_glossary", "reference_point", "data_points_window_months",
  "personal_overrides"
];

// Subkeys of why_we_think_this that remain read-only (machine lists).
const WHY_WE_THINK_READONLY_SUBKEYS = ["signals_used"];
// Prose subkeys the editor may rewrite.
const WHY_WE_THINK_EDITABLE_SUBKEYS = ["reasoning", "counterarguments", "what_would_make_us_wrong"];

// Editable prose keys on a signal the draft may set.
const SIGNAL_EDITABLE_KEYS = [
  "title", "summary", "status", "status_tone", "momentum_label", "pill_label_short",
  "chain", "refined_why", "why_we_think_this"
];

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Apply one drafted signal's prose onto a live signal object (mutates the copy).
function applySignal(liveSig, draftSig, editorialDate) {
  liveSig.title = draftSig.title;
  liveSig.summary = draftSig.summary;
  liveSig.status = draftSig.status;
  liveSig.status_tone = draftSig.status_tone;
  liveSig.momentum_label = draftSig.momentum_label;
  liveSig.pill_label_short = draftSig.pill_label_short;
  // chain: preserve each step's existing non-prose keys; replace text/expansion/label.
  if (Array.isArray(draftSig.chain)) {
    const existing = Array.isArray(liveSig.chain) ? liveSig.chain : [];
    liveSig.chain = draftSig.chain.map((step, i) => {
      const base = existing[i] ? clone(existing[i]) : {};
      base.label = step.label;
      base.text = step.text;
      if (step.expansion != null) base.expansion = step.expansion;
      return base;
    });
  }
  if (draftSig.refined_why) {
    liveSig.refined_why = Object.assign({}, liveSig.refined_why, {
      evidence: draftSig.refined_why.evidence,
      counter_signal: draftSig.refined_why.counter_signal,
      product_takeaway: draftSig.refined_why.product_takeaway
    });
  }
  // why_we_think_this: rewrite ONLY the prose subfields; preserve signals_used
  // (the read-only machine list) exactly as it was.
  if (draftSig.why_we_think_this) {
    const base = Object.assign({}, liveSig.why_we_think_this); // keeps signals_used
    const d = draftSig.why_we_think_this;
    if (d.reasoning != null) base.reasoning = d.reasoning;
    if (d.counterarguments != null) base.counterarguments = d.counterarguments.slice();
    if (d.what_would_make_us_wrong != null) base.what_would_make_us_wrong = d.what_would_make_us_wrong;
    liveSig.why_we_think_this = base;
  }
  // Editorial freshness bookkeeping (so data-validate recompute agrees).
  liveSig.last_editorial_reviewed = editorialDate;
  liveSig.alignment_status = "aligned"; // gate already proved polarity; recompute will confirm
  liveSig.review_required = false;
  return liveSig;
}

function applyWeeklyConnection(liveWC, draftWC, editorialDate) {
  liveWC.title = draftWC.title;
  liveWC.subtitle = draftWC.subtitle;
  if (Array.isArray(draftWC.body_paragraphs)) liveWC.body_paragraphs = draftWC.body_paragraphs.slice();
  if (draftWC.refined) {
    liveWC.refined = Object.assign({}, liveWC.refined, {
      observation: draftWC.refined.observation,
      why_it_matters: draftWC.refined.why_it_matters,
      pm_implication_default: draftWC.refined.pm_implication_default,
      decision_this_week: draftWC.refined.decision_this_week
    });
  }
  liveWC.date = editorialDate;
  liveWC.date_label = monthDayLabel(editorialDate);
  liveWC.last_editorial_reviewed = editorialDate;
  liveWC.review_required = false;
  liveWC.narrative_review_required = false;
  return liveWC;
}

function applyWeeklyThought(liveWT, draftWT, editorialDate) {
  liveWT.headline = draftWT.headline;
  if (draftWT.lenses && liveWT.lenses) {
    Object.keys(draftWT.lenses).forEach((k) => {
      if (!liveWT.lenses[k]) liveWT.lenses[k] = {};
      const d = draftWT.lenses[k];
      liveWT.lenses[k].label = d.label;
      liveWT.lenses[k].pattern = d.pattern;
      liveWT.lenses[k].action = d.action;
      if (d.sketchbook_note != null) liveWT.lenses[k].sketchbook_note = d.sketchbook_note;
    });
  }
  liveWT.last_editorial_reviewed = editorialDate;
  return liveWT;
}

function monthDayLabel(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
  return mon + " " + d.getUTCDate();
}

// Apply the whole draft. Returns a NEW content object (does not mutate input).
function applyDraft(liveContent, draft, opts) {
  opts = opts || {};
  const editorialDate = draft.editorial_date || (opts.now ? new Date(opts.now) : new Date()).toISOString().slice(0, 10);
  const out = clone(liveContent);

  const byId = {};
  (out.signals || []).forEach((s) => { if (s && s.id) byId[s.id] = s; });

  (draft.signals || []).forEach((ds) => {
    const live = byId[ds.signal_id];
    if (live) applySignal(live, ds, editorialDate);
  });

  if (draft.weekly_connection) {
    out.weekly_connection = out.weekly_connection || {};
    applyWeeklyConnection(out.weekly_connection, draft.weekly_connection, editorialDate);
  }
  if (draft.weekly_thought) {
    out.weekly_thought = out.weekly_thought || {};
    applyWeeklyThought(out.weekly_thought, draft.weekly_thought, editorialDate);
  }
  if (draft.page_prose) {
    if (draft.page_prose.weekly_note_text != null) {
      out.weekly_note = out.weekly_note || {};
      out.weekly_note.text = draft.page_prose.weekly_note_text;
    }
    if (draft.page_prose.pm_tension_question != null || draft.page_prose.pm_tension_note != null) {
      out.pm_tension = out.pm_tension || {};
      if (draft.page_prose.pm_tension_question != null) out.pm_tension.question = draft.page_prose.pm_tension_question;
      if (draft.page_prose.pm_tension_note != null) out.pm_tension.note = draft.page_prose.pm_tension_note;
    }
  }
  return out;
}

/* ---------- editorial-only diff guard ---------- */
// Assert that, between `before` and `after`, NO read-only data path changed.
// Returns { ok, violations: [path...] }.
function diffGuard(before, after) {
  const violations = [];
  const beforeById = {};
  (before.signals || []).forEach((s) => { if (s && s.id) beforeById[s.id] = s; });
  const afterById = {};
  (after.signals || []).forEach((s) => { if (s && s.id) afterById[s.id] = s; });

  // signals must not be added/removed
  const beforeIds = Object.keys(beforeById).sort();
  const afterIds = Object.keys(afterById).sort();
  if (beforeIds.join(",") !== afterIds.join(",")) {
    violations.push("signals: set of signal ids changed (" + beforeIds.length + " -> " + afterIds.length + ")");
  }

  // per signal, every read-only key must be deep-equal
  beforeIds.forEach((id) => {
    const b = beforeById[id], a = afterById[id];
    if (!a) return;
    SIGNAL_READONLY_KEYS.forEach((k) => {
      if (!deepEqual(b[k], a[k])) {
        violations.push("signals[" + id + "]." + k + " changed (read-only data)");
      }
    });
    // why_we_think_this is now partially editable: its prose subfields may move,
    // but signals_used (the machine data list) must NOT.
    const bw = (b && b.why_we_think_this) || {};
    const aw = (a && a.why_we_think_this) || {};
    WHY_WE_THINK_READONLY_SUBKEYS.forEach((k) => {
      if (!deepEqual(bw[k], aw[k])) {
        violations.push("signals[" + id + "].why_we_think_this." + k + " changed (read-only data)");
      }
    });
  });

  // top-level read-only blocks
  ["categories", "source_philosophy", "phase_meta", "whats_changed"].forEach((k) => {
    if (!deepEqual(before[k], after[k])) violations.push(k + " changed (read-only)");
  });
  // weekly_connection: connected_signals + curated are read-only
  const bwc = before.weekly_connection || {}, awc = after.weekly_connection || {};
  if (!deepEqual(bwc.connected_signals, awc.connected_signals)) violations.push("weekly_connection.connected_signals changed (read-only)");
  if (!deepEqual(bwc.curated, awc.curated)) violations.push("weekly_connection.curated changed (read-only)");

  return { ok: violations.length === 0, violations };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

module.exports = {
  applyDraft,
  diffGuard,
  SIGNAL_READONLY_KEYS,
  SIGNAL_EDITABLE_KEYS,
  WHY_WE_THINK_READONLY_SUBKEYS,
  WHY_WE_THINK_EDITABLE_SUBKEYS,
  monthDayLabel
};
