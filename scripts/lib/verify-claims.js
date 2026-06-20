"use strict";
/* =============================================================================
   verify-claims.js — deterministic content-vs-data reconciler  (Phase 2)
   -----------------------------------------------------------------------------
   Dependency-free (Node standard library + pulse-trust only). Pure functions:
   no network, no process.exit, no file writes. This is the SPINE of the Phase 2
   quality gate — the "double/triple check the content against the data points"
   the project requires. It NEVER trusts the editorial agent's self-grade; every
   verdict here is computed mechanically from the drafted prose and the real
   signal data in pulse-content.json.

   It checks five things on a content-draft (automation/schemas/content-draft):

     1. NUMBERS    — every numeric token in the drafted prose must reconcile to a
                     real data value for that signal (current_value, any
                     data_points[].value, compared_to.*.delta_pct, percentile.value)
                     within rounding tolerance, OR be an allowlisted illustrative
                     number. Any unexplained number is a HARD failure (a fabricated
                     figure is the worst thing that can ship).
     2. POLARITY   — each drafted `status` word, read through the signal's
                     editorial_polarity, must agree with the computed data
                     direction. Reuses pulse-trust.checkEditorialAlignment so the
                     gate uses the EXACT same logic the live page masks on.
     3. NARRATIVE  — the drafted Weekly Connection prose direction must not
                     contradict the aggregate signal directions
                     (pulse-trust.checkNarrativeAlignment). HARD fail on mismatch.
     4. ADVICE     — scan all drafted prose for investment-advice / market-
                     prediction language. HARD fail on a hit.
     5. FRESHNESS  — the draft's editorial_date must be today (the run date), so
                     applying it leaves edited items review_required=false.

   Returns a plain object the runner folds into the quality report. The runner
   (not this module) decides GREEN/YELLOW/RED.
   ===========================================================================*/

const trust = require("./pulse-trust");

/* ---------- number reconciliation ---------- */

// Pull every numeric token out of a blob of prose. Captures signed decimals and
// percentages: "-0.4", "10.3", "+10.7%", "49.8", "60%". Dollar/sci handled by
// stripping $ and unicode minus first (matches pulse-trust.parseLooseNumber).
function extractNumbers(text) {
  if (!text) return [];
  const s = String(text).replace(/\u2212/g, "-");
  const matches = s.match(/[+-]?\$?\d+(?:\.\d+)?%?/g) || [];
  const out = [];
  for (const m of matches) {
    const n = trust.parseLooseNumber(m);
    if (n != null) out.push({ raw: m.trim(), value: n });
  }
  return out;
}

// Build the set of real data values a signal's prose is allowed to cite.
function dataValuesForSignal(liveSignal) {
  const vals = [];
  const push = (v) => { const n = trust.parseLooseNumber(v); if (n != null) vals.push(n); };
  if (!liveSignal) return vals;
  push(liveSignal.current_value);
  (liveSignal.data_points || []).forEach((p) => { if (p && p.value != null) push(p.value); });
  const cmp = liveSignal.compared_to || {};
  ["vs_1mo", "vs_6mo", "vs_12mo"].forEach((k) => {
    if (cmp[k] && cmp[k].delta_pct != null) push(cmp[k].delta_pct);
  });
  if (liveSignal.percentile && liveSignal.percentile.value != null) push(liveSignal.percentile.value);
  if (liveSignal.percentile && liveSignal.percentile.label) {
    // labels like "Lower than 56% of observations" carry a legitimate derived number
    extractNumbers(liveSignal.percentile.label).forEach((t) => vals.push(t.value));
  }
  return vals;
}

// Allowlisted illustrative numbers (see editable-fields-map.md). Small counts,
// standard window sizes, and the current/adjacent years. Deliberately tiny.
function buildAllowlist(now) {
  const yr = (now || new Date()).getUTCFullYear();
  const set = new Set([0, 1, 2, 3, 6, 7, 10, 12, 24, 30, 35]);
  for (let y = yr - 2; y <= yr + 1; y++) set.add(y);
  return set;
}

// Does a prose number match any allowed data value within tolerance?
// Tolerance: exact for integers; for decimals, |a-b| <= 0.05 absolute OR the two
// round to the same 1-decimal display (handles 10.3 vs 10.30 vs "+10.7%").
function reconcilesTo(value, dataVals, allowlist) {
  if (allowlist.has(value)) return true;
  // also allow the absolute value matching the allowlist (e.g. "-2 months")
  if (allowlist.has(Math.abs(value))) return true;
  for (const d of dataVals) {
    if (value === d) return true;
    if (Math.abs(value - d) <= 0.05) return true;
    if (Math.round(value * 10) === Math.round(d * 10)) return true;
    // sign-insensitive match: a draft may write "0.4 below zero" for a -0.4 reading
    if (Math.abs(Math.abs(value) - Math.abs(d)) <= 0.05) return true;
  }
  return false;
}

// Gather all prose strings for one drafted signal entry.
function signalProseStrings(sig) {
  const parts = [sig.title, sig.summary, sig.momentum_label, sig.pill_label_short];
  (sig.chain || []).forEach((c) => { parts.push(c.text); parts.push(c.expansion); });
  if (sig.refined_why) {
    parts.push(sig.refined_why.evidence, sig.refined_why.counter_signal, sig.refined_why.product_takeaway);
  }
  return parts.filter(Boolean);
}

/* ---------- advice / prediction scan ---------- */
// Conservative keyword scan. We are NOT a financial product; investment advice
// or price-prediction framing is a hard fail. Patterns are written to catch the
// FINANCIAL sense only — plain business verbs like "sell into manufacturers" or
// "buy software" must NOT trip the gate. So bare buy/sell/short are intentionally
// NOT flagged; we require an investment object (stock/shares/the dip/etc.) or an
// explicit market-prediction / portfolio framing. Whole-word, case-insensitive.
const ADVICE_PATTERNS = [
  /\b(?:buy|sell|short|trade)\s+(?:the\s+)?(?:stock|stocks|shares|equit(?:y|ies)|the\s+dip|the\s+market|bonds|crypto|bitcoin)\b/i,
  /\bgo long\b/i, /\boverweight\b/i, /\bunderweight\b/i,
  /\bprice target\b/i,
  /\b(?:stocks?|shares?|the market|prices?|the index|rates?)\s+will\s+(?:rise|fall|drop|surge|plunge|hit|reach|climb|crash)\b/i,
  /\bguaranteed returns?\b/i, /\bbullish\b/i, /\bbearish\b/i,
  /\binvest in\b/i, /\byour portfolio\b/i, /\basset allocation\b/i,
  /\byou should (?:buy|sell|invest|trade)\b/i
];
function scanAdvice(text) {
  const hay = String(text || "");
  const hits = [];
  for (const re of ADVICE_PATTERNS) {
    const m = hay.match(re);
    if (m) hits.push(m[0].toLowerCase());
  }
  return hits;
}

/* ---------- main entry ---------- */
/*
  verifyDraft(draft, liveContent, registry, options)
    draft       — a content-draft object (pre-apply)
    liveContent — current data/pulse-content.json (source of truth for data values)
    registry    — data/signals_registry.json (for polarity + alignment)
    options     — { now: Date }

  Returns:
    {
      pass, numbers_ok, polarity_ok, narrative_ok, advice_clean, freshness_ok,
      hard_failures: [{check, field, detail}],
      soft_warnings: [{check, field, detail}],
      unreconciled_numbers: [string]
    }
*/
function verifyDraft(draft, liveContent, registry, options) {
  options = options || {};
  const now = options.now ? new Date(options.now) : new Date();
  const hard = [];
  const soft = [];
  const unreconciled = [];

  const liveById = {};
  (liveContent && Array.isArray(liveContent.signals) ? liveContent.signals : []).forEach((s) => {
    if (s && s.id) liveById[s.id] = s;
  });
  const allowlist = buildAllowlist(now);

  /* ---- 1. NUMBERS ---- */
  let numbersOk = true;
  (draft.signals || []).forEach((sig) => {
    const live = liveById[sig.signal_id];
    if (!live) {
      hard.push({ check: "numbers", field: sig.signal_id, detail: "drafted a signal that is not in live content: " + sig.signal_id });
      numbersOk = false;
      return;
    }
    const dataVals = dataValuesForSignal(live);
    const proseNums = [];
    signalProseStrings(sig).forEach((p) => extractNumbers(p).forEach((t) => proseNums.push(t)));
    for (const t of proseNums) {
      if (!reconcilesTo(t.value, dataVals, allowlist)) {
        numbersOk = false;
        unreconciled.push(sig.signal_id + ": " + t.raw);
        hard.push({ check: "numbers", field: sig.signal_id, detail: "prose number " + t.raw + " does not reconcile to any data value or the allowlist" });
      }
    }
  });
  // Weekly Connection + Weekly Thought numbers: must reconcile to SOME connected
  // signal's data (or allowlist). These narratives blend multiple signals, so we
  // check against the union of all live data values.
  const unionVals = [];
  Object.values(liveById).forEach((s) => dataValuesForSignal(s).forEach((v) => unionVals.push(v)));
  function checkNarrativeNumbers(strings, label) {
    (strings || []).filter(Boolean).forEach((p) => {
      extractNumbers(p).forEach((t) => {
        if (!reconcilesTo(t.value, unionVals, allowlist)) {
          numbersOk = false;
          unreconciled.push(label + ": " + t.raw);
          hard.push({ check: "numbers", field: label, detail: "narrative number " + t.raw + " does not reconcile to any signal's data or the allowlist" });
        }
      });
    });
  }
  if (draft.weekly_connection) {
    const wc = draft.weekly_connection;
    const r = wc.refined || {};
    checkNarrativeNumbers([wc.title, wc.subtitle, ...(wc.body_paragraphs || []),
      r.observation, r.why_it_matters, r.pm_implication_default, r.decision_this_week], "weekly_connection");
  }
  if (draft.weekly_thought) {
    const wt = draft.weekly_thought;
    const strs = [wt.headline];
    Object.values(wt.lenses || {}).forEach((l) => { strs.push(l.pattern, l.action, l.label, l.sketchbook_note); });
    checkNarrativeNumbers(strs, "weekly_thought");
  }
  if (draft.page_prose) {
    checkNarrativeNumbers([draft.page_prose.weekly_note_text, draft.page_prose.pm_tension_question, draft.page_prose.pm_tension_note], "page_prose");
  }

  /* ---- 2. POLARITY (status word vs computed data direction) ---- */
  let polarityOk = true;
  (draft.signals || []).forEach((sig) => {
    const live = liveById[sig.signal_id];
    if (!live) return; // already hard-failed above
    // Build the candidate published signal: live DATA + drafted status word.
    const candidate = Object.assign({}, live, { status: sig.status });
    const align = trust.checkEditorialAlignment(registry, candidate, null);
    if (align.alignment_status === "mismatch") {
      polarityOk = false;
      hard.push({
        check: "polarity",
        field: sig.signal_id,
        detail: "drafted status '" + sig.status + "' " + align.detail
      });
    }
  });

  /* ---- 3. NARRATIVE (Weekly Connection direction vs aggregate signals) ---- */
  let narrativeOk = true;
  if (draft.weekly_connection) {
    // Construct the candidate WC narrative object the trust checker expects, using
    // drafted prose but the LIVE connected_signals + the live signal data.
    const liveWC = (liveContent && liveContent.weekly_connection) || {};
    const wc = draft.weekly_connection;
    const candidateWC = {
      title: wc.title,
      subtitle: wc.subtitle,
      body_paragraphs: wc.body_paragraphs || [],
      refined: wc.refined || {},
      connected_signals: liveWC.connected_signals || []
    };
    const liveSignals = (liveContent && liveContent.signals) || [];
    const nar = trust.checkNarrativeAlignment(candidateWC, liveSignals, registry);
    if (nar.narrative_review_required) {
      narrativeOk = false;
      hard.push({ check: "narrative", field: "weekly_connection", detail: nar.review_note });
    } else if (nar.dominant_direction_in_narrative && !nar.minimum_count_met) {
      soft.push({ check: "narrative", field: "weekly_connection", detail: nar.review_note });
    }
  }

  /* ---- 4. ADVICE scan over ALL drafted prose ---- */
  let adviceClean = true;
  const allProse = [];
  (draft.signals || []).forEach((sig) => signalProseStrings(sig).forEach((p) => allProse.push(p)));
  if (draft.weekly_connection) {
    const wc = draft.weekly_connection, r = wc.refined || {};
    allProse.push(wc.title, wc.subtitle, ...(wc.body_paragraphs || []), r.observation, r.why_it_matters, r.pm_implication_default, r.decision_this_week);
  }
  if (draft.weekly_thought) {
    allProse.push(draft.weekly_thought.headline);
    Object.values(draft.weekly_thought.lenses || {}).forEach((l) => allProse.push(l.pattern, l.action, l.label, l.sketchbook_note));
  }
  if (draft.page_prose) {
    allProse.push(draft.page_prose.weekly_note_text, draft.page_prose.pm_tension_question, draft.page_prose.pm_tension_note);
  }
  allProse.filter(Boolean).forEach((p) => {
    const hits = scanAdvice(p);
    if (hits.length) {
      adviceClean = false;
      hard.push({ check: "advice", field: "prose", detail: "investment-advice / prediction language: " + hits.join(", ") });
    }
  });

  /* ---- 5. FRESHNESS (editorial_date must be today) ---- */
  let freshnessOk = true;
  const today = now.toISOString().slice(0, 10);
  if (draft.editorial_date !== today) {
    freshnessOk = false;
    hard.push({ check: "freshness", field: "editorial_date", detail: "editorial_date " + draft.editorial_date + " is not today (" + today + ")" });
  }

  const pass = numbersOk && polarityOk && narrativeOk && adviceClean && freshnessOk;
  return {
    pass,
    numbers_ok: numbersOk,
    polarity_ok: polarityOk,
    narrative_ok: narrativeOk,
    advice_clean: adviceClean,
    freshness_ok: freshnessOk,
    hard_failures: hard,
    soft_warnings: soft,
    unreconciled_numbers: unreconciled
  };
}

module.exports = {
  verifyDraft,
  extractNumbers,
  dataValuesForSignal,
  reconcilesTo,
  scanAdvice,
  buildAllowlist
};
