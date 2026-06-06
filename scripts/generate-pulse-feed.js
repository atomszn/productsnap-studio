#!/usr/bin/env node
/*
 * generate-pulse-feed.js
 * -----------------------------------------------------------------------------
 * Builds /pulse-feed.json — a machine-readable summary of the current Pulse
 * for AI agents and other consumers. It is DERIVED from data/pulse-content.json
 * and is strictly read-only against that file.
 *
 * Trust contract (mirrors js/pulse.js exactly):
 *   - When the Weekly Connection is "under review" (narrative_review_required,
 *     review_required, or a connected signal in alignment mismatch), the feed
 *     OMITS the confident interpretation and emits the same honest fallback the
 *     site shows. Machines must never read a stale take we've already gated on
 *     the human page.
 *   - Per-signal: when a signal is under review, its confident summary is held
 *     back the same way. The number/value still ships (it's factual).
 *
 * Pulse framing rule (per site owner): Pulse is NOT financial analysis,
 * investment advice, or market prediction. It connects signals, tracks change,
 * and asks better product questions. The disclaimer below states this plainly.
 *
 * Usage:
 *   node scripts/generate-pulse-feed.js            # write pulse-feed.json
 *   node scripts/generate-pulse-feed.js --check    # verify it's up to date (CI),
 *                                                   # exit 1 if stale. No writes.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_PATH = path.join(ROOT, "data", "pulse-content.json");
const OUTPUT_PATH = path.join(ROOT, "pulse-feed.json");
const SITE = "https://productsnap.studio";

const args = process.argv.slice(2);
const CHECK = args.includes("--check");

// --- trust-gate logic (mirrors js/pulse.js TRUST_FALLBACK_* / *NeedsReview) ---
const WC_FALLBACK_COPY =
  "This week's interpretation is under review — the signal picture has shifted. Updated context coming soon.";
const TRUST_FALLBACK_SHORT = "Interpretation under review.";
const SIGNAL_FALLBACK_COPY =
  "This signal moved enough to revisit the interpretation. Updated context coming soon.";

function signalNeedsReview(signal) {
  if (!signal) return false;
  return signal.review_required === true || signal.alignment_status === "mismatch";
}

function weeklyConnectionNeedsReview(conn, signalsById) {
  if (!conn) return false;
  if (conn.narrative_review_required === true) return true;
  if (conn.review_required === true) return true;
  const connected = conn.connected_signals || [];
  return connected.some((id) => {
    const s = signalsById[id];
    return s && s.alignment_status === "mismatch";
  });
}

function buildFeed(content) {
  const signals = content.signals || [];
  const signalsById = {};
  for (const s of signals) signalsById[s.id] = s;

  const wc = content.weekly_connection || {};
  const wt = content.weekly_thought || {};
  const tension = content.pm_tension || {};
  const refined = wc.refined || {};

  const wcUnderReview = weeklyConnectionNeedsReview(wc, signalsById);

  // Lenses: weekly_thought.lenses is a keyed object (build/customer/business/future).
  const lensOrder = ["build", "customer", "business", "future"];
  const lenses = lensOrder
    .filter((k) => wt.lenses && wt.lenses[k])
    .map((k) => {
      const l = wt.lenses[k];
      return {
        id: k,
        label: l.label || k,
        pattern: l.pattern || "",
        question_to_ask: l.action || "",
      };
    });

  // Signals referenced by this week's thinking (connected_signals on the WC).
  const referencedIds = wc.connected_signals || [];
  const signalsReferenced = referencedIds
    .map((id) => signalsById[id])
    .filter(Boolean)
    .map((s) => {
      const underReview = signalNeedsReview(s);
      const sources = (s.sources || []).map((src) => ({
        name: src.name,
        url: src.url,
      }));
      const ts = s.timestamps || {};
      const out = {
        id: s.id,
        title: s.title || "",
        category: s.category || "",
        current_value:
          (s.current_value || "") + (s.current_unit ? " " + s.current_unit : ""),
        status: s.status || "",
        source_data_date: ts.latest_source_data_date || s.last_updated || null,
        sources,
      };
      // Plain-English read of the signal — held back if under review.
      out.plain_english = underReview ? SIGNAL_FALLBACK_COPY : (s.summary || "");
      out.under_review = underReview;
      return out;
    });

  // The product questions this week's thinking asks (lens actions + tension).
  const productQuestions = [];
  for (const l of lenses) {
    if (l.question_to_ask) productQuestions.push(l.question_to_ask);
  }
  if (tension.question) productQuestions.push(tension.question);

  // Plain-English explanation of the weekly thought — always factual headline,
  // plus the gated interpretation where allowed.
  const weeklyThought = {
    headline: wt.headline || "",
    plain_english: wcUnderReview
      ? WC_FALLBACK_COPY
      : (refined.observation || ""),
    why_it_matters: wcUnderReview
      ? TRUST_FALLBACK_SHORT
      : (refined.why_it_matters || ""),
    lenses,
    under_review: wcUnderReview,
  };

  // Source dates summary (latest source data date across referenced signals).
  const sourceDates = signalsReferenced
    .map((s) => s.source_data_date)
    .filter(Boolean)
    .sort();
  const latestSourceDate = sourceDates.length
    ? sourceDates[sourceDates.length - 1]
    : null;

  const lastUpdated = wt.last_editorial_reviewed ||
    (wc.editorial_freshness && wc.editorial_freshness.last_editorial_reviewed) ||
    null;

  return {
    $schema: "https://productsnap.studio/pulse-feed.schema.json",
    title: "ProductSnap Studio — Pulse weekly feed",
    description:
      "A machine-readable summary of this week's Pulse: the weekly thought, the lenses it can be read through, the signals it references, and the product questions it raises. Derived from the live Pulse data; gated interpretations are withheld when under editorial review.",
    site: SITE,
    pulse_url: SITE + "/pulse",
    generated_from: "data/pulse-content.json",
    last_updated: lastUpdated,
    latest_source_data_date: latestSourceDate,
    is_financial_advice: false,
    disclaimer:
      "Pulse is not financial analysis, investment advice, or market prediction. It connects public signals, tracks how things are changing, and turns that into better product questions. Always verify against primary sources before acting.",
    weekly_thought: weeklyThought,
    weekly_connection: {
      title: wc.title || "",
      subtitle: wc.subtitle || "",
      under_review: wcUnderReview,
      observation: wcUnderReview ? WC_FALLBACK_COPY : (refined.observation || ""),
      why_it_matters: wcUnderReview
        ? TRUST_FALLBACK_SHORT
        : (refined.why_it_matters || ""),
      decision_this_week: wcUnderReview ? "" : (refined.decision_this_week || ""),
    },
    pm_tension: {
      label: tension.label || "",
      axis: tension.axis || "",
      question: tension.question || "",
      note: tension.note || "",
    },
    product_questions: productQuestions,
    signals_referenced: signalsReferenced,
    sources_note:
      "Pulse reads from a three-tier source system: Tier 1 (official datasets — Fed, BLS, Treasury, BEA, FRED, Census) drives conclusions; Tier 2/3 support framing.",
  };
}

function main() {
  if (!fs.existsSync(CONTENT_PATH)) {
    console.error("generate-pulse-feed: missing " + CONTENT_PATH);
    process.exit(1);
  }
  const content = JSON.parse(fs.readFileSync(CONTENT_PATH, "utf8"));
  const feed = buildFeed(content);
  const feedText = JSON.stringify(feed, null, 2) + "\n";

  if (CHECK) {
    if (!fs.existsSync(OUTPUT_PATH)) {
      console.error("CHECK: pulse-feed.json is missing — run the generator.");
      process.exit(1);
    }
    const current = fs.readFileSync(OUTPUT_PATH, "utf8");
    if (current !== feedText) {
      console.error(
        "CHECK: pulse-feed.json is out of date with pulse-content.json — run: node scripts/generate-pulse-feed.js"
      );
      process.exit(1);
    }
    console.log("CHECK: pulse-feed.json is up to date.");
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, feedText, "utf8");
  console.log(
    "Wrote pulse-feed.json (under_review=" +
      feed.weekly_connection.under_review +
      ", signals_referenced=" +
      feed.signals_referenced.length +
      ")."
  );
}

main();
