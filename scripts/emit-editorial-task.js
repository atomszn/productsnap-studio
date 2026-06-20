#!/usr/bin/env node
/* =============================================================================
   emit-editorial-task.js — write the typed editorial HANDOFF task (dep-free)
   -----------------------------------------------------------------------------
   This is the seam between the deterministic GitHub pipeline and the AI layer.
   It reads the LATEST KEEP/DRAFT decision (data/pulse-editorial-decision.json),
   and — when the decision is DRAFT and the automation phase allows it — writes
   a typed, schema-validated task to data/pulse-editorial-task.json describing
   exactly what changed and what context the research agent needs.

   It NEVER calls AI. It NEVER publishes content. It only writes a task file.
   The AI research agent runs separately, inside Perplexity Computer, polling
   for this task. That keeps GitHub dependency-free and keeps the AI layer
   incapable of breaking the factual data refresh.

   IDEMPOTENCY: the task carries a `fingerprint` — a stable hash of the
   triggering change (signal ids + from/to + reasons + decision). If a task
   with the same fingerprint already exists AND already has matching findings,
   re-emitting is a no-op marked skipped_idempotent, so re-running the pipeline
   does not spawn duplicate research.

   PHASE GATING:
     phase 0  -> do nothing (pure log-only; matches pre-automation behavior)
     phase >=1 with editorial_automation_enabled -> emit the task on DRAFT
   On KEEP, no task is written (and a stale task may be cleared, see below).

   Exit code is always 0 unless inputs are unreadable. This step must never
   break a green pipeline.

   Usage:
     node scripts/emit-editorial-task.js            # normal
     node scripts/emit-editorial-task.js --dry-run  # print task, write nothing
   ===========================================================================*/
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { validate } = require("./lib/schema-validate");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "automation", "automation-config.json");
const DECISION_PATH = path.join(ROOT, "data", "pulse-editorial-decision.json");
const CONTENT_PATH = path.join(ROOT, "data", "pulse-content.json");
const REGISTRY_PATH = path.join(ROOT, "data", "signals_registry.json");
const TASK_PATH = path.join(ROOT, "data", "pulse-editorial-task.json");
const FINDINGS_PATH = path.join(ROOT, "data", "pulse-research-findings.json");
const SCHEMA_PATH = path.join(ROOT, "automation", "schemas", "editorial-task.schema.json");

const DISCLAIMER = "Pulse is not financial analysis, investment advice, or market prediction.";

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function readJSONSafe(p) { try { return readJSON(p); } catch (e) { return null; } }

function contentById(content) {
  const map = {};
  (Array.isArray(content.signals) ? content.signals : []).forEach((s) => {
    if (s && s.id) map[s.id] = s;
  });
  return map;
}
function registryById(registry) {
  const map = {};
  (Array.isArray(registry && registry.signals) ? registry.signals : []).forEach((e) => {
    if (e && e.signal_id) map[e.signal_id] = e;
  });
  return map;
}

// Stable fingerprint of the triggering change — order-independent over signals.
function computeFingerprint(decision) {
  const parts = [];
  (decision.triggers || []).forEach((t) => {
    if (t.type === "material_data_move" && Array.isArray(t.signals)) {
      t.signals
        .slice()
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .forEach((s) => parts.push([s.id, s.from, s.to, (s.reasons || []).join("|")].join(":")));
    } else {
      parts.push(t.type);
    }
  });
  const basis = decision.decision + "||" + parts.join(";;");
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

function firstSource(signal, reg) {
  const src = Array.isArray(signal && signal.sources) && signal.sources.length ? signal.sources[0] : null;
  const series = reg && reg.source_series ? reg.source_series : {};
  const out = {
    name: (src && src.name) || (reg && reg.source) || "source",
    url: (src && src.url) || ""
  };
  if (series.series_id) out.series_id = series.series_id;
  if (series.provider) out.provider = series.provider;
  if (src && src.tier != null) out.tier = src.tier;
  return out;
}

// Build one schema-valid scope entry for a signal id. `mv` (optional) carries
// the material_data_move from/to/delta/reasons when the signal was triggered by
// a data move; for narrative/staleness scope there is no move and those fields
// are left null/empty (all optional in the schema).
function buildScopeEntry(id, cMap, rMap, mv) {
  const c = cMap[id] || {};
  const reg = rMap[id] || {};
  mv = mv || {};
  const entry = {
    id,
    name: reg.name || c.display_name || c.title || id,
    current_value: c.current_value != null ? c.current_value : null,
    unit: reg.unit || c.current_unit || "",
    from: mv.from != null ? mv.from : null,
    to: mv.to != null ? mv.to : null,
    delta: mv.delta != null ? mv.delta : null,
    reasons: Array.isArray(mv.reasons) ? mv.reasons : [],
    source: firstSource(c, reg)
  };
  if (c.display_name) entry.display_name = c.display_name;
  if (reg.category) entry.category = reg.category;
  if (c.summary) entry.existing_summary = c.summary;
  if (reg.alignment && reg.alignment.editorial_polarity) entry.editorial_polarity = reg.alignment.editorial_polarity;
  return entry;
}

function buildSignalsInScope(decision, cMap, rMap, content) {
  // The signals a DRAFT needs context on depend on WHY it triggered:
  //   - material_data_move        -> the moved signals (with from/to/delta).
  //   - editorial_stale w/ stale_signals -> EXACTLY those per-signal stale reads
  //                                  (e.g. an 80-day-old consumer-confidence
  //                                  summary). These may NOT be Weekly Connection
  //                                  connected_signals, so they must be scoped
  //                                  explicitly or they would never get refreshed.
  //   - narrative_review_required -> the Weekly Connection's connected_signals
  //                                  (the narrative being re-examined rests on them).
  //   - editorial_stale (WC read aged, no per-signal list) -> same WC
  //                                  connected_signals fallback.
  // Without this, a narrative/staleness-only DRAFT yielded an EMPTY scope and the
  // schema (minItems:1) refused the task, stalling the whole editorial loop.
  const triggers = decision.triggers || [];
  const moveById = {};
  const staleIds = [];
  triggers.forEach((t) => {
    if (t.type === "material_data_move" && Array.isArray(t.signals)) {
      t.signals.forEach((s) => { if (s && s.id) moveById[s.id] = s; });
    }
    // editorial_stale may carry a per-signal stale_signals[] (added by
    // draft-editorial.js). Scope EXACTLY those reads — they are the summaries
    // that aged out and need a fresh editorial pass.
    if (t.type === "editorial_stale" && Array.isArray(t.stale_signals)) {
      t.stale_signals.forEach((x) => { if (x && x.id) staleIds.push(x.id); });
    }
  });

  const wantsNarrativeScope = triggers.some(
    (t) => t.type === "narrative_review_required" || t.type === "editorial_stale"
  );
  const wc = (content && content.weekly_connection) || {};
  const connected = wantsNarrativeScope && Array.isArray(wc.connected_signals)
    ? wc.connected_signals.filter((id) => typeof id === "string" && id)
    : [];

  // Ordered, de-duplicated id list: moved signals first (most specific), then
  // explicitly-stale per-signal reads, then the narrative's connected signals.
  // A signal appearing in more than one bucket is kept once; a moved signal
  // keeps its move fields (moveById[id] is undefined for non-moved ids).
  const orderedIds = [];
  const seen = new Set();
  const push = (id) => { if (id && !seen.has(id)) { seen.add(id); orderedIds.push(id); } };
  Object.keys(moveById).forEach(push);
  staleIds.forEach(push);
  connected.forEach(push);

  return orderedIds.map((id) => buildScopeEntry(id, cMap, rMap, moveById[id]));
}

function buildTask(decision, config, cMap, rMap, content) {
  const fingerprint = computeFingerprint(decision);
  const now = new Date();

  const triggers = (decision.triggers || []).map((t) => {
    const base = { type: t.type, detail: t.detail || "" };
    if (Array.isArray(t.signals)) {
      base.signals = t.signals.map((s) => ({
        id: s.id,
        from: s.from != null ? s.from : null,
        to: s.to != null ? s.to : null,
        delta: s.delta != null ? s.delta : 0,
        reasons: Array.isArray(s.reasons) ? s.reasons : []
      }));
    }
    return base;
  });

  const wc = content.weekly_connection || {};
  const wcReviewFlagged = (decision.triggers || []).some((t) => t.type === "narrative_review_required");

  const task = {
    schema_version: "1.0.0",
    task_id: "editorial-task-" + fingerprint,
    created_at: now.toISOString(),
    source_decision_generated_at: decision.generated_at || now.toISOString(),
    phase: Number(config.editorial_automation_phase) || 0,
    shadow_mode: config.shadow_mode !== false,
    fingerprint,
    decision: decision.decision,
    triggers,
    signals_in_scope: buildSignalsInScope(decision, cMap, rMap, content),
    weekly_connection_in_scope: {
      included: !!wcReviewFlagged,
      title: wc.title || "",
      last_reviewed: wc.last_editorial_reviewed || wc.date || null,
      observation: (wc.refined && wc.refined.observation) || ""
    },
    constraints: {
      reading_grade_target_max: Number(config.reading_grade_target_max) || 9,
      disclaimer: DISCLAIMER,
      must_not_change: [
        "Pulse signal data values",
        "app store links",
        "trust gates",
        "workflows"
      ]
    },
    status: "pending"
  };
  return task;
}

function main() {
  const dryRun = process.argv.indexOf("--dry-run") !== -1;

  const config = readJSONSafe(CONFIG_PATH);
  const decision = readJSONSafe(DECISION_PATH);
  if (!config || !decision) {
    console.error("[emit-task] missing config or decision; nothing to do.");
    process.exit(0);
  }

  const phase = Number(config.editorial_automation_phase) || 0;
  const enabled = !(config.kill_switch && config.kill_switch.editorial_automation_enabled === false);

  // Phase 0 or kill-switch off -> deliberately inert. Matches pre-automation behavior.
  if (phase < 1 || !enabled) {
    console.log("[emit-task] phase=" + phase + " enabled=" + enabled + " -> no task emitted (inert).");
    process.exit(0);
  }

  // KEEP -> no task. Clear any stale pending task so the runner doesn't re-research.
  if (decision.decision !== "DRAFT") {
    if (!dryRun && fs.existsSync(TASK_PATH)) {
      const existing = readJSONSafe(TASK_PATH);
      if (existing && existing.status === "pending") {
        existing.status = "skipped_idempotent";
        fs.writeFileSync(TASK_PATH, JSON.stringify(existing, null, 2) + "\n");
        console.log("[emit-task] decision=KEEP -> retired stale pending task " + existing.task_id);
      }
    }
    console.log("[emit-task] decision=" + decision.decision + " -> no task emitted.");
    process.exit(0);
  }

  const content = readJSONSafe(CONTENT_PATH) || { signals: [] };
  const registry = readJSONSafe(REGISTRY_PATH) || { signals: [] };
  const cMap = contentById(content);
  const rMap = registryById(registry);

  const task = buildTask(decision, config, cMap, rMap, content);

  // Validate against schema BEFORE writing — a malformed task must never ship.
  const schema = readJSONSafe(SCHEMA_PATH);
  if (schema) {
    const res = validate(task, schema);
    if (!res.valid) {
      console.error("[emit-task] task FAILED schema validation; refusing to write:");
      res.errors.forEach((e) => console.error("  · " + e.path + ": " + e.message));
      process.exit(0); // do not break the pipeline; just don't emit a bad task
    }
  }

  // Idempotency: if findings already exist for this exact fingerprint, mark skipped.
  const findings = readJSONSafe(FINDINGS_PATH);
  const alreadyResearched = findings && findings.fingerprint === task.fingerprint;
  if (alreadyResearched) {
    task.status = "skipped_idempotent";
    console.log("[emit-task] findings already exist for fingerprint " + task.fingerprint + " -> skipped_idempotent.");
  }

  if (dryRun) {
    console.log("[emit-task] --dry-run; task that WOULD be written:\n" + JSON.stringify(task, null, 2));
    process.exit(0);
  }

  fs.writeFileSync(TASK_PATH, JSON.stringify(task, null, 2) + "\n");
  console.log("[emit-task] wrote " + path.relative(ROOT, TASK_PATH) +
    " task_id=" + task.task_id + " status=" + task.status +
    " signals=" + task.signals_in_scope.map((s) => s.id).join(","));
  process.exit(0);
}

module.exports = { computeFingerprint, buildTask };

if (require.main === module) main();
