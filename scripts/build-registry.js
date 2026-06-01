#!/usr/bin/env node
/* =====================================================================
   build-registry.js  —  one-shot generator for data/signals_registry.json
   ---------------------------------------------------------------------
   Pulse Trust Guardrails (Pass D).

   This script encodes the master signal registry as data and writes it to
   data/signals_registry.json. It is dependency-free (Node standard library
   only) and is safe to re-run: it derives every entry from the constants
   below plus light cross-checking against data/pulse-content.json so the
   18 current signals stay in sync.

   The registry is the single source of truth for validation, threshold,
   alignment, cadence and editorial-ownership rules. It is intentionally
   verbose and forward-scalable to 25+/40+ signals: adding a new signal is
   a matter of adding one object to SIGNALS below (or appending directly to
   the generated JSON).
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_PATH = path.join(ROOT, "data", "pulse-content.json");
const OUT_PATH = path.join(ROOT, "data", "signals_registry.json");

/* ---------------------------------------------------------------------
   Reusable validation-rule presets per category.
   Conservative, generic guardrails. Signal-specific overrides win.
   --------------------------------------------------------------------- */
const CATEGORY_DEFAULTS = {
  inflation: {
    // YoY percent rates. Cannot teleport from ~3% to 32%.
    value_type: "percent",
    expected_range: [-5, 20],
    max_abs_step: 3.0,              // max change between consecutive prints (pct points)
    max_pct_step: 200,             // relative guard (e.g. 3% -> 9% = +200%)
    cadence: "monthly",
    cadence_grace_days: 20,
    direction_field: "compared_to.vs_12mo.direction"
  },
  liquidity: {
    value_type: "mixed",
    cadence: "weekly",
    cadence_grace_days: 14,
    direction_field: "compared_to.vs_12mo.direction"
  },
  labor: {
    value_type: "mixed",
    cadence: "monthly",
    cadence_grace_days: 20,
    direction_field: "compared_to.vs_12mo.direction"
  },
  consumer: {
    value_type: "mixed",
    cadence: "monthly",
    cadence_grace_days: 20,
    direction_field: "compared_to.vs_12mo.direction"
  },
  "ai-tech": {
    value_type: "mixed",
    cadence: "event-driven",
    cadence_grace_days: 45,
    direction_field: "compared_to.vs_12mo.direction"
  },
  regulation: {
    value_type: "categorical",
    cadence: "event-driven",
    cadence_grace_days: 60,
    direction_field: "compared_to.vs_12mo.direction"
  },
  activity: {
    // Diffusion index centred at 0 (growth vs contraction).
    value_type: "index",
    expected_range: [-60, 60],
    max_abs_step: 20,
    cadence: "monthly",
    cadence_grace_days: 20,
    direction_field: "compared_to.vs_12mo.direction"
  }
};

/* ---------------------------------------------------------------------
   Vocabulary for editorial-alignment mismatch detection.
   Each entry maps an editorial "stance" word to the data direction it
   implies. The validator flags a mismatch when copy claims one stance but
   the measured direction (numeric trend) contradicts it.

   Direction semantics: "rising"/"up" = numeric value increasing,
   "falling"/"down" = decreasing. For inflation/cost categories a *rising*
   value is "hotter/accelerating"; for cost-of-AI a *falling* value is
   "easing/cheaper". Polarity per signal is captured in editorial_polarity.
   --------------------------------------------------------------------- */
const STANCE_VOCAB = {
  // word                : implied numeric direction of the underlying value
  rising: "up", climbing: "up", accelerating: "up", reaccelerating: "up",
  heating: "up", "heated up": "up", hotter: "up", surging: "up",
  expanding: "up", growing: "up", strengthening: "up", improving_up: "up",
  cooling: "down", easing: "down", falling: "down", slowing: "down",
  weakening: "down", softening: "down", contracting: "down",
  declining: "down", cheaper: "down", dropping: "down", tightening_down: "down"
};

/* Antonym pairs used for direct mismatch checks in copy. */
const STANCE_ANTONYMS = [
  ["rising", "cooling"], ["rising", "falling"], ["climbing", "falling"],
  ["accelerating", "slowing"], ["accelerating", "decelerating"],
  ["improving", "weakening"], ["strengthening", "weakening"],
  ["expanding", "contracting"], ["tightening", "easing"],
  ["heating up", "cooling"], ["hotter", "cooler"], ["growing", "shrinking"]
];

/* ---------------------------------------------------------------------
   The 18 current signals. Each carries the trust metadata the validator
   needs. Anything omitted falls back to the category default above.

   editorial_polarity:
     "value_up_is_negative"  -> a rising value is bad for the buyer
                                 (inflation, yields, cost). Editorial words
                                 like "heating up" expect direction "up".
     "value_down_is_positive"-> a falling value is good / "easing"
                                 (AI cost). "easing/cheaper" expects "down".
     "value_up_is_positive"  -> a rising value is good / "expanding".
     "neutral"               -> no fixed polarity.
   --------------------------------------------------------------------- */
const SIGNALS = [
  {
    signal_id: "cpi-headline", category: "inflation",
    name: "Headline CPI (YoY)", unit: "year-over-year %",
    source: "BLS", source_series: { provider: "FRED", series_id: "CPIAUCSL", transform: "yoy_pct" },
    refresh_frequency: "monthly", status_type: "automated",
    editorial_owner: "macro-editor",
    expected_range: [-2, 18], max_abs_step: 2.5,
    editorial_polarity: "value_up_is_negative",
    editorial_blocks: ["summary", "status", "chain", "refined_why"]
  },
  {
    signal_id: "ppi", category: "inflation",
    name: "Producer Price Index (YoY)", unit: "year-over-year %",
    source: "BLS", source_series: { provider: "FRED", series_id: "PPIACO", transform: "yoy_pct" },
    refresh_frequency: "monthly", status_type: "automated",
    editorial_owner: "macro-editor",
    expected_range: [-8, 20], max_abs_step: 3.5,
    editorial_polarity: "value_up_is_negative",
    editorial_blocks: ["summary", "status", "chain", "refined_why"]
  },
  {
    signal_id: "pce", category: "inflation",
    name: "Core PCE (YoY)", unit: "year-over-year %, core",
    source: "BEA", source_series: { provider: "FRED", series_id: "PCEPILFE", transform: "yoy_pct" },
    refresh_frequency: "monthly", status_type: "automated",
    editorial_owner: "macro-editor",
    expected_range: [-2, 12], max_abs_step: 2.0,
    editorial_polarity: "value_up_is_negative",
    editorial_blocks: ["summary", "status", "chain", "refined_why"]
  },
  {
    signal_id: "fed-net-liquidity", category: "liquidity",
    name: "Fed Net Liquidity / Balance Sheet", unit: "USD trillions (total balance sheet)",
    source: "Federal Reserve (H.4.1)",
    source_series: { provider: "FRED", series_id: "WALCL", transform: "level_usd_t" },
    refresh_frequency: "weekly", status_type: "automated",
    editorial_owner: "macro-editor",
    expected_range: [3, 12], max_pct_step: 8,
    editorial_polarity: "neutral",
    editorial_blocks: ["summary", "status", "chain", "refined_why"]
  },
  {
    signal_id: "10y-treasury", category: "liquidity",
    name: "10-Year Treasury Yield", unit: "yield %",
    source: "U.S. Treasury / FRED",
    source_series: { provider: "FRED", series_id: "DGS10", transform: "level_pct" },
    refresh_frequency: "daily", status_type: "automated",
    editorial_owner: "macro-editor",
    expected_range: [0, 10], max_abs_step: 0.5,   // 50bps/day soft; >2.0 = hard review
    max_abs_step_hard: 2.0,                         // 200bps -> needs_review
    cadence: "daily", cadence_grace_days: 4,
    editorial_polarity: "value_up_is_negative",
    editorial_blocks: ["summary", "status", "chain", "refined_why"]
  },
  {
    signal_id: "series-a-counts", category: "liquidity",
    name: "Series A Round Counts (trailing 3mo, US)", unit: "rounds (trailing 3mo, US, curated)",
    source: "Crunchbase News (curated)",
    source_series: { provider: "manual", series_id: null, transform: "count" },
    refresh_frequency: "weekly-curated", status_type: "manual",
    editorial_owner: "venture-editor",
    expected_range: [0, 2000], max_pct_step: 60,
    cadence: "weekly", cadence_grace_days: 21,
    editorial_polarity: "value_up_is_positive",
    editorial_blocks: ["summary", "status", "refined_why"]
  },
  {
    signal_id: "ai-model-releases", category: "ai-tech",
    name: "Frontier AI Model Release Activity", unit: "frontier releases per 2-week window",
    source: "Editorial tracker (release logs)",
    source_series: { provider: "manual", series_id: null, transform: "count" },
    refresh_frequency: "event-driven", status_type: "manual",
    editorial_owner: "ai-editor",
    expected_range: [0, 40], max_abs_step: 12,
    editorial_polarity: "value_up_is_positive",
    editorial_blocks: ["summary", "status", "refined_why"]
  },
  {
    signal_id: "ai-api-pricing", category: "ai-tech",
    name: "AI API / Inference Pricing Trend", unit: "% change, trailing 3mo, top model prices",
    source: "Editorial pricing tracker (vendor price sheets)",
    source_series: { provider: "manual", series_id: null, transform: "pct_change" },
    refresh_frequency: "event-driven", status_type: "manual",
    editorial_owner: "ai-editor",
    expected_range: [-95, 50], max_abs_step: 40,
    editorial_polarity: "value_down_is_positive",
    editorial_blocks: ["summary", "status", "chain", "refined_why"]
  },
  {
    signal_id: "open-source-ai", category: "ai-tech",
    name: "Open-Source AI Momentum (agent frameworks)", unit: "YoY star growth % · agent frameworks",
    source: "GitHub (curated repo set)",
    source_series: { provider: "manual", series_id: null, transform: "yoy_pct" },
    refresh_frequency: "weekly-curated", status_type: "manual",
    editorial_owner: "ai-editor",
    expected_range: [-50, 500], max_pct_step: 100,
    editorial_polarity: "value_up_is_positive",
    editorial_blocks: ["summary", "status", "refined_why"]
  },
  {
    signal_id: "compute-cost", category: "ai-tech",
    name: "Effective Compute Cost per Workload", unit: "YoY effective cost per workload %",
    source: "Editorial cost model (cloud GPU price sheets)",
    source_series: { provider: "manual", series_id: null, transform: "yoy_pct" },
    refresh_frequency: "monthly-curated", status_type: "manual",
    editorial_owner: "ai-editor",
    expected_range: [-80, 50], max_abs_step: 30,
    editorial_polarity: "value_down_is_positive",
    editorial_blocks: ["summary", "status", "refined_why"]
  },
  {
    signal_id: "retail-sales", category: "consumer",
    name: "Retail Sales (YoY)", unit: "year-over-year %",
    source: "U.S. Census Bureau",
    source_series: { provider: "FRED", series_id: "RSAFS", transform: "yoy_pct" },
    refresh_frequency: "monthly", status_type: "automated",
    editorial_owner: "consumer-editor",
    expected_range: [-20, 25], max_abs_step: 6,
    editorial_polarity: "value_up_is_positive",
    editorial_blocks: ["summary", "status", "chain", "refined_why"]
  },
  {
    signal_id: "consumer-confidence", category: "consumer",
    name: "Consumer Sentiment (U. Michigan)", unit: "University of Michigan index",
    source: "University of Michigan / FRED",
    source_series: { provider: "FRED", series_id: "UMCSENT", transform: "level" },
    refresh_frequency: "monthly", status_type: "automated",
    editorial_owner: "consumer-editor",
    expected_range: [40, 120], max_abs_step: 15,
    editorial_polarity: "value_up_is_positive",
    editorial_blocks: ["summary", "status", "chain", "refined_why"]
  },
  {
    signal_id: "emerging-apps", category: "consumer",
    name: "Emerging App Category Patterns", unit: "category emergence across charts",
    source: "Editorial app-chart triangulation",
    source_series: { provider: "manual", series_id: null, transform: "pattern" },
    refresh_frequency: "event-driven", status_type: "manual",
    editorial_owner: "consumer-editor",
    value_type: "categorical",
    editorial_polarity: "value_up_is_positive",
    editorial_blocks: ["summary", "status", "refined_why"]
  },
  {
    signal_id: "nonfarm-payrolls", category: "labor",
    name: "Nonfarm Payrolls (monthly change)", unit: "jobs · monthly change",
    source: "BLS",
    source_series: { provider: "FRED", series_id: "PAYEMS", transform: "mom_diff" },
    refresh_frequency: "monthly", status_type: "automated",
    editorial_owner: "labor-editor",
    expected_range: [-1000, 1200], unit_scale: "thousands", max_abs_step: 600,
    editorial_polarity: "value_up_is_positive",
    editorial_blocks: ["summary", "status", "chain", "refined_why"]
  },
  {
    signal_id: "tech-hiring", category: "labor",
    name: "Tech Hiring Intensity (percentile)", unit: "percentile vs last 10 years",
    source: "Editorial (job postings / layoffs.fyi blend)",
    source_series: { provider: "manual", series_id: null, transform: "percentile" },
    refresh_frequency: "weekly-curated", status_type: "manual",
    editorial_owner: "labor-editor",
    expected_range: [0, 100], max_abs_step: 30,
    editorial_polarity: "value_up_is_positive",
    editorial_blocks: ["summary", "status", "refined_why"]
  },
  {
    signal_id: "ai-regulation", category: "regulation",
    name: "AI Regulation & Policy Developments", unit: "category — irregular cadence",
    source: "Editorial AI regulation tracker",
    source_series: { provider: "manual", series_id: null, transform: "categorical" },
    refresh_frequency: "event-driven", status_type: "manual",
    editorial_owner: "policy-editor",
    value_type: "categorical",
    editorial_polarity: "value_up_is_negative",
    editorial_blocks: ["summary", "status", "refined_why"]
  },
  {
    signal_id: "mfg-activity", category: "activity",
    name: "Manufacturing Activity (diffusion index)", unit: "diffusion index, seasonally adjusted",
    source: "Regional Fed / ISM-style (curated)",
    source_series: { provider: "FRED", series_id: "GACDISA066MSFRBNY", transform: "level" },
    refresh_frequency: "monthly", status_type: "automated",
    editorial_owner: "activity-editor",
    expected_range: [-60, 60], max_abs_step: 25, centered_zero: true,
    editorial_polarity: "value_up_is_positive",
    editorial_blocks: ["summary", "status", "refined_why"]
  },
  {
    signal_id: "services-activity", category: "activity",
    name: "Services Activity (diffusion index)", unit: "diffusion index, seasonally adjusted",
    source: "Regional Fed / ISM-style (curated)",
    source_series: { provider: "FRED", series_id: "GACDFSA066MSFRBNY", transform: "level" },
    refresh_frequency: "monthly", status_type: "automated",
    editorial_owner: "activity-editor",
    expected_range: [-60, 60], max_abs_step: 25, centered_zero: true,
    editorial_polarity: "value_up_is_positive",
    editorial_blocks: ["summary", "status", "refined_why"]
  }
];

/* --------------------------------------------------------------------- */
function buildEntry(sig, contentSignal) {
  const cat = CATEGORY_DEFAULTS[sig.category] || {};
  const validation = {
    require_numeric: (sig.value_type || cat.value_type) !== "categorical",
    value_type: sig.value_type || cat.value_type || "mixed",
    require_value_present: true,
    require_unit_match: true,
    require_source_mapping: true,
    // dates must be valid and not in the future; new value should be >= stored
    require_valid_date: true,
    reject_future_dates: true,
    require_nondecreasing_date: true,
    require_within_expected_range: true
  };
  const thresholds = {
    expected_range: sig.expected_range || cat.expected_range || null,
    max_abs_step: sig.max_abs_step != null ? sig.max_abs_step : (cat.max_abs_step != null ? cat.max_abs_step : null),
    max_abs_step_hard: sig.max_abs_step_hard != null ? sig.max_abs_step_hard : null,
    max_pct_step: sig.max_pct_step != null ? sig.max_pct_step : (cat.max_pct_step != null ? cat.max_pct_step : 200),
    centered_zero: !!sig.centered_zero,
    outlier_action: "needs_review"   // breach -> flag, do not overwrite trusted value
  };
  const cadence = {
    refresh_frequency: sig.refresh_frequency,
    cadence: sig.cadence || cat.cadence || "monthly",
    cadence_grace_days: sig.cadence_grace_days != null ? sig.cadence_grace_days : (cat.cadence_grace_days != null ? cat.cadence_grace_days : 20),
    // stale_after_days = how long before the stored value is considered stale
    stale_after_days: staleAfterFor(sig)
  };
  const alignment = {
    direction_field: cat.direction_field || "compared_to.vs_12mo.direction",
    editorial_polarity: sig.editorial_polarity || "neutral",
    editorial_blocks: sig.editorial_blocks || ["summary", "status"],
    mismatch_action: { alignment_status: "mismatch", review_required: true }
  };
  return {
    signal_id: sig.signal_id,
    name: sig.name,
    category: sig.category,
    category_label: contentSignal ? contentSignal.category_label : null,
    source: sig.source,
    source_series: sig.source_series,
    unit: sig.unit,
    refresh_frequency: sig.refresh_frequency,
    status_type: sig.status_type,            // "manual" | "automated"
    editorial_owner: sig.editorial_owner,
    tier: contentSignal ? (contentSignal.tier || null) : null,
    validation,
    thresholds,
    cadence,
    alignment,
    // current snapshot mirrored for traceability (not authoritative — content json is)
    current_value_ref: contentSignal ? contentSignal.current_value : null,
    current_last_updated_ref: contentSignal ? contentSignal.last_updated : null
  };
}

function staleAfterFor(sig) {
  // Conservative: ~2x cadence for automated, looser for curated/event-driven.
  switch (sig.refresh_frequency) {
    case "daily": return 4;
    case "weekly": return 15;
    case "weekly-curated": return 21;
    case "monthly": return 65;
    case "monthly-curated": return 75;
    case "event-driven": return 45;
    default: return 60;
  }
}

/* --------------------------------------------------------------------- */
function main() {
  const content = JSON.parse(fs.readFileSync(CONTENT_PATH, "utf8"));
  const byId = {};
  (content.signals || []).forEach((s) => { byId[s.id] = s; });

  const registrySignals = SIGNALS.map((sig) => buildEntry(sig, byId[sig.signal_id]));

  // Sanity: every content signal must be represented.
  const missing = (content.signals || [])
    .map((s) => s.id)
    .filter((id) => !registrySignals.find((r) => r.signal_id === id));

  const registry = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    description:
      "Master trust registry for Pulse signals. Single source of truth for " +
      "validation, threshold/outlier, cadence, alignment and editorial rules. " +
      "Scalable to 25+/40+ signals — add one object per signal.",
    status_model: ["verified", "stale", "needs_review", "failed", "manual"],
    alignment_status_values: ["aligned", "mismatch", "unknown"],
    stance_vocabulary: STANCE_VOCAB,
    stance_antonyms: STANCE_ANTONYMS,
    category_defaults: CATEGORY_DEFAULTS,
    editorial_freshness_policy: {
      weekly_connection_expires_after_days: 7,
      per_signal_thesis_expires_after_days: 35,
      editorial_status_values: ["current", "aging", "stale"],
      tracked_fields: ["last_editorial_reviewed", "expires_after_days", "editorial_status"]
    },
    signal_count: registrySignals.length,
    signals: registrySignals,
    _integrity: {
      content_signal_count: (content.signals || []).length,
      missing_from_registry: missing
    }
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(registry, null, 2) + "\n", "utf8");
  console.log("Wrote " + OUT_PATH);
  console.log("  signals in registry : " + registrySignals.length);
  console.log("  signals in content  : " + (content.signals || []).length);
  if (missing.length) console.log("  WARNING missing     : " + missing.join(", "));
  else console.log("  integrity           : OK (all content signals represented)");
}

main();
