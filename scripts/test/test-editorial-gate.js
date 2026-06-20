#!/usr/bin/env node
/* =============================================================================
   test-editorial-gate.js — Phase 2 quality-gate regression suite
   -----------------------------------------------------------------------------
   Dependency-free (Node built-ins only). Exercises the deterministic pieces of
   the editorial gate WITHOUT calling any AI and WITHOUT touching live content:

     · reconciler verify-claims: numbers / polarity / advice / freshness
     · apply-editorial: applyDraft writes editorial-only; diffGuard catches
       any read-only data path change (the structural backstop)
     · the verdict mapping the runner uses (GREEN/YELLOW/RED), reproduced here
       as a pure function so a regression in the thresholds is caught.

   These checks are the safety contract: a fabricated number, a flipped status on
   a directional signal, advice language, a stale date, or any data tampering
   must NEVER produce a GREEN/publishable verdict.
   ===========================================================================*/
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const verify = require(path.join(ROOT, "scripts", "lib", "verify-claims.js"));
const apply = require(path.join(ROOT, "scripts", "lib", "apply-editorial.js"));

const content = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "pulse-content.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "signals_registry.json"), "utf8"));

let failures = 0;
function ok(name, cond) {
  if (cond) { console.log("  ok  - " + name); }
  else { console.log("  FAIL- " + name); failures++; }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
const today = new Date().toISOString().slice(0, 10);

// Build a minimal, schema-shaped draft signal entry from a live signal so the
// reconciler has the fields it expects. Caller overrides the prose under test.
function draftSignalFrom(id, overrides) {
  const s = content.signals.find((x) => x.id === id);
  return Object.assign({
    signal_id: id,
    title: s.title,
    summary: s.summary,
    status: s.status,
    status_tone: s.status_tone || "neutral",
    momentum_label: s.momentum_label || "watch the trend",
    pill_label_short: s.pill_label_short || "watch",
    chain: s.chain && s.chain.length ? s.chain : [{ label: "Signal", text: "placeholder text here" }],
    refined_why: s.refined_why || { evidence: "placeholder evidence text", counter_signal: "placeholder counter text", product_takeaway: "placeholder takeaway text" }
  }, overrides || {});
}
function draftWith(signalEntry) {
  return { editorial_date: today, signals: [signalEntry] };
}

// Pure reproduction of the runner's verdict mapping (keep in sync with
// editorial-runner.js cmdGate). Lets us assert the band logic deterministically.
// clarityClean (Phase 3 whole-page jargon/grade gate) is now part of hardClean:
// unexplained jargon or a too-hard page anywhere is a hard RED, exactly like a
// reconciler or structural failure.
function verdictOf(rec, validation, structural, thresholds, clarityClean) {
  const { greenConf, yellowConf, gradeMax } = thresholds;
  const conf = Number(validation.confidence);
  const structuralClean = structural.draftSchemaValid && structural.editorialOnlyDiff && structural.testsPass;
  const clarOk = clarityClean !== false; // default true when not under test
  const hardClean = rec.pass && structuralClean && clarOk &&
    validation.disclaimer_respected !== false &&
    validation.honest_no_overclaim !== false &&
    validation.reading_grade <= gradeMax;
  if (!hardClean || conf < yellowConf) return "RED";
  if (conf >= greenConf && rec.soft_warnings.length === 0) return "GREEN";
  return "YELLOW";
}

// Pure reproduction of the runner's PUBLISH decision (keep in sync with
// editorial-runner.js cmdGate publish block). Returns the action string.
function publishActionOf(verdict, conf, clarityClean, cfg) {
  const autoPublishEnabled = cfg.auto_publish_enabled === true;
  const shadow = cfg.shadow_mode !== false;
  const paused = cfg.pause_auto_publish === true;
  const publishBar = Number(cfg.publish_confidence_threshold) || 0.95;
  const enabled = cfg.editorial_automation_enabled !== false;
  const eligible = verdict === "GREEN";
  const publishAllowed = eligible && clarityClean && conf >= publishBar &&
    autoPublishEnabled && enabled && !shadow && !paused;
  if (verdict === "RED") return "held_safe";
  if (publishAllowed) return "auto_publish";
  if (autoPublishEnabled && enabled && !shadow) return "held_below_bar";
  return "review_pr";
}
const THRESH = { greenConf: 0.9, yellowConf: 0.7, gradeMax: 9 };
const cleanStructural = { draftSchemaValid: true, editorialOnlyDiff: true, testsPass: true };
const cleanValidation = { confidence: 0.93, reading_grade: 8, disclaimer_respected: true, honest_no_overclaim: true };

console.log("test-editorial-gate");

/* ---------------- reconciler: numbers ---------------- */
(function () {
  const good = draftWith(draftSignalFrom("mfg-activity", {
    summary: "The gauge moved from -0.4 last month to 10.3 this month, a choppy read near zero."
  }));
  const r1 = verify.verifyDraft(good, content, registry, { now: new Date() });
  ok("clean draft mirroring live numbers passes reconciler", r1.pass === true && r1.numbers_ok === true);

  const bad = draftWith(draftSignalFrom("mfg-activity", {
    summary: "The index surged to 99.7 this month, an all-time record."
  }));
  const r2 = verify.verifyDraft(bad, content, registry, { now: new Date() });
  ok("fabricated number 99.7 fails numbers_ok", r2.numbers_ok === false && r2.pass === false);
})();

/* ---------------- reconciler: polarity (directional signal) ---------------- */
(function () {
  // ai-api-pricing registry stance is directional (falling/down). A status that
  // implies the opposite direction must trip the polarity check.
  const d = draftWith(draftSignalFrom("ai-api-pricing", { status: "rising", status_tone: "green" }));
  const r = verify.verifyDraft(d, content, registry, { now: new Date() });
  ok("status 'rising' on a falling signal fails polarity_ok", r.polarity_ok === false && r.pass === false);

  // A genuinely choppy signal has no fixed direction -> any status is aligned.
  const c = draftWith(draftSignalFrom("mfg-activity", { status: "falling" }));
  const rc = verify.verifyDraft(c, content, registry, { now: new Date() });
  ok("choppy signal has no fixed direction (polarity stays ok)", rc.polarity_ok === true);
})();

/* ---------------- reconciler: advice + freshness ---------------- */
(function () {
  const adv = draftWith(draftSignalFrom("mfg-activity", {
    refined_why: { evidence: "moved from -0.4 to 10.3 this month", counter_signal: "it has flipped sign all year", product_takeaway: "Investors should buy the stock before it rallies." }
  }));
  const ra = verify.verifyDraft(adv, content, registry, { now: new Date() });
  ok("investment-advice language fails advice_clean", ra.advice_clean === false && ra.pass === false);

  const stale = { editorial_date: "2026-01-01", signals: [draftSignalFrom("mfg-activity", {})] };
  const rf = verify.verifyDraft(stale, content, registry, { now: new Date() });
  ok("stale editorial_date fails freshness_ok", rf.freshness_ok === false && rf.pass === false);
})();

/* ---------------- apply + diff guard ---------------- */
(function () {
  const draft = draftWith(draftSignalFrom("mfg-activity", { title: "A regional factory gauge bounced back into positive territory" }));
  const applied = apply.applyDraft(content, draft, { now: new Date() });
  const guard = apply.diffGuard(content, applied);
  ok("editorial-only apply passes diff guard", guard.ok === true);

  const mfgBefore = content.signals.find((s) => s.id === "mfg-activity");
  const mfgAfter = applied.signals.find((s) => s.id === "mfg-activity");
  ok("apply preserves current_value (read-only data)", mfgBefore.current_value === mfgAfter.current_value);
  ok("apply changes the editorial title", mfgAfter.title === "A regional factory gauge bounced back into positive territory");

  // tamper a data value -> guard must catch it
  const tampered = clone(applied);
  tampered.signals.find((s) => s.id === "mfg-activity").current_value = "999";
  const g2 = apply.diffGuard(content, tampered);
  ok("diff guard catches tampered current_value", g2.ok === false && g2.violations.some((v) => /current_value/.test(v)));

  // applyDraft must not mutate its input
  const sentinel = content.signals.find((s) => s.id === "mfg-activity").title;
  apply.applyDraft(content, draftWith(draftSignalFrom("mfg-activity", { title: "MUTATION CHECK XYZ" })), { now: new Date() });
  ok("applyDraft does not mutate the input content", content.signals.find((s) => s.id === "mfg-activity").title === sentinel);
})();

/* ---------------- verdict mapping ---------------- */
(function () {
  const recClean = { pass: true, soft_warnings: [] };
  const recSoft = { pass: true, soft_warnings: [{ check: "x", detail: "y" }] };
  const recFail = { pass: false, soft_warnings: [] };

  ok("GREEN: clean + conf 0.93", verdictOf(recClean, { ...cleanValidation, confidence: 0.93 }, cleanStructural, THRESH) === "GREEN");
  ok("YELLOW: clean + conf 0.80 (band)", verdictOf(recClean, { ...cleanValidation, confidence: 0.80 }, cleanStructural, THRESH) === "YELLOW");
  ok("YELLOW: GREEN-conf but a soft warning", verdictOf(recSoft, { ...cleanValidation, confidence: 0.95 }, cleanStructural, THRESH) === "YELLOW");
  ok("RED: conf 0.55 below floor", verdictOf(recClean, { ...cleanValidation, confidence: 0.55 }, cleanStructural, THRESH) === "RED");
  ok("RED: reconciler hard failure beats high conf", verdictOf(recFail, { ...cleanValidation, confidence: 0.99 }, cleanStructural, THRESH) === "RED");
  ok("RED: reading grade 12 > max", verdictOf(recClean, { ...cleanValidation, confidence: 0.99, reading_grade: 12 }, cleanStructural, THRESH) === "RED");
  ok("RED: structural failure (diff guard) beats high conf", verdictOf(recClean, { ...cleanValidation, confidence: 0.99 }, { ...cleanStructural, editorialOnlyDiff: false }, THRESH) === "RED");
  // clarity now folds into hardClean:
  ok("RED: unexplained jargon (clarityClean=false) beats high conf",
    verdictOf(recClean, { ...cleanValidation, confidence: 0.99 }, cleanStructural, THRESH, false) === "RED");
  ok("GREEN: same draft with clarityClean=true is GREEN",
    verdictOf(recClean, { ...cleanValidation, confidence: 0.99 }, cleanStructural, THRESH, true) === "GREEN");
})();

/* ---------------- publish decision (Phase 3 auto-publish bar) ---------------- */
(function () {
  // Fully armed config: auto-publish on, not shadow, not paused, bar 0.95.
  const armed = { auto_publish_enabled: true, shadow_mode: false, pause_auto_publish: false,
    publish_confidence_threshold: 0.95, editorial_automation_enabled: true };

  ok("PUBLISH: GREEN + conf 0.96 + clarity clean + armed -> auto_publish",
    publishActionOf("GREEN", 0.96, true, armed) === "auto_publish");
  ok("HOLD: GREEN + conf 0.92 (below 0.95 bar) -> held_below_bar (silent retry)",
    publishActionOf("GREEN", 0.92, true, armed) === "held_below_bar");
  ok("HOLD: GREEN + conf 0.99 but clarity NOT clean -> held_below_bar",
    publishActionOf("GREEN", 0.99, false, armed) === "held_below_bar");
  ok("HOLD: paused kill-switch forces hold even at conf 0.99 + clarity clean",
    publishActionOf("GREEN", 0.99, true, { ...armed, pause_auto_publish: true }) === "held_below_bar");
  ok("RED never publishes (held_safe) even fully armed",
    publishActionOf("RED", 0.99, true, armed) === "held_safe");
  ok("SHADOW: shadow_mode true -> review_pr, never publishes",
    publishActionOf("GREEN", 0.99, true, { ...armed, shadow_mode: true }) === "review_pr");
  ok("DISARMED: auto_publish_enabled false -> review_pr",
    publishActionOf("GREEN", 0.99, true, { ...armed, auto_publish_enabled: false }) === "review_pr");
  ok("YELLOW + armed -> held_below_bar (armed, but not GREEN)",
    publishActionOf("YELLOW", 0.99, true, armed) === "held_below_bar");
})();

if (failures > 0) { console.error("\ntest-editorial-gate: " + failures + " FAILURE(S)"); process.exit(1); }
console.log("\ntest-editorial-gate: all checks passed");
process.exit(0);
