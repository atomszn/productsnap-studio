#!/usr/bin/env node
/* =============================================================================
   editorial-runner.js — Computer-side orchestrator for Phase 2 editorial
   -----------------------------------------------------------------------------
   Companion to research-runner.js. Same philosophy: this script runs in
   PERPLEXITY COMPUTER, NOT in the GitHub Actions pipeline. It is dependency-free
   (Node built-ins + local libs only). The AI drafting/validation is done by
   subagents in Computer; this script does everything deterministic around them:
   read the findings, check phase/kill-switch/budget, select a model, VALIDATE
   the AI output against schemas, run the deterministic reconciler + diff guard,
   compute the GREEN/YELLOW/RED verdict, and (only on GREEN + armed) apply the
   editorial prose to pulse-content.json.

   Pipeline (each AI stage split prep/ingest, mirroring research-runner):

     1) --draft-prep
            Requires Phase >= 2, kill-switch on, completed research findings for
            the pending task's fingerprint, and budget headroom. Selects the
            editorial model and prints a prep payload (task + findings +
            live_content + editable map + model + editorial_date). The editorial
            subagent reads it and writes a candidate content-draft.

     2) --draft-ingest <candidate-draft.json>
            Validates the candidate against content-draft.schema, stamps
            provenance, writes data/pulse-content-draft.json, appends the
            editorial spend to the ledger.

     3) --validate-prep
            Selects the validation model (different provider) and prints a prep
            payload (draft + findings + live_content + task). The validation
            subagent writes a candidate validation object.

     4) --validate-ingest <candidate-validation.json>
            Validates it against the validation_agent sub-schema, appends the
            validation spend to the ledger, stashes it for the gate.

     5) --gate
            Pure deterministic decision. Runs verify-claims (numbers/polarity/
            narrative/advice/freshness), applies the draft to a COPY of content,
            runs the editorial-only diff guard + data-validate recompute + all
            test suites, folds in the validation confidence, and computes
            GREEN/YELLOW/RED. Writes data/pulse-quality-report.json + a run
            record. On GREEN AND auto_publish_enabled AND kill-switch on AND NOT
            shadow_mode it ALSO writes the applied content to pulse-content.json
            (the only path that touches live) and reports action=auto_publish.
            Otherwise action=review_pr / held_safe and live content is untouched.

   Exit codes: 0 success/skip; 2 = invalid AI output on ingest; 3 = no actionable
   task/findings; 4 = blocked (disabled / budget stop); 5 = gate RED (held safe).
   ===========================================================================*/
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { validate } = require("../scripts/lib/schema-validate");
const budget = require("../scripts/check-budget.js");
const verifyClaims = require("../scripts/lib/verify-claims");
const applyEditorial = require("../scripts/lib/apply-editorial");
const clarityScan = require("../scripts/lib/clarity-scan");
const noAdviceScan = require("../scripts/lib/no-advice-scan");
const narrativeConsistency = require("../scripts/lib/narrative-consistency");
const postPublishCheck = require("../scripts/lib/post-publish-check");
const materiality = require("../scripts/lib/materiality");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "automation", "automation-config.json");
const REGISTRY_PATH = path.join(ROOT, "automation", "model-registry.json");
const LEDGER_PATH = path.join(ROOT, "automation", "spend-ledger.json");
const RUNS_DIR = path.join(ROOT, "automation", "runs");
const TASK_PATH = path.join(ROOT, "data", "pulse-editorial-task.json");
const DECISION_PATH = path.join(ROOT, "data", "pulse-editorial-decision.json");
const FINDINGS_PATH = path.join(ROOT, "data", "pulse-research-findings.json");
const CONTENT_PATH = path.join(ROOT, "data", "pulse-content.json");
const REGISTRY_DATA_PATH = path.join(ROOT, "data", "signals_registry.json");
const DRAFT_PATH = path.join(ROOT, "data", "pulse-content-draft.json");
const REPORT_PATH = path.join(ROOT, "data", "pulse-quality-report.json");
const VALIDATION_STASH = path.join(ROOT, "data", ".pulse-validation-candidate.json");
const VALIDATION_PANEL_STASH = path.join(ROOT, "data", "pulse-validation-panel.json");
const DRAFT_SCHEMA = path.join(ROOT, "automation", "schemas", "content-draft.schema.json");
const QUALITY_SCHEMA = path.join(ROOT, "automation", "schemas", "quality-report.schema.json");
const RUN_SCHEMA = path.join(ROOT, "automation", "schemas", "run-record.schema.json");

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function readJSONSafe(p) { try { return readJSON(p); } catch (e) { return null; } }
function isoDate(d) { return (d || new Date()).toISOString().slice(0, 10); }
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); }

function makeId(fingerprint, dateStr, role) {
  return crypto.createHash("sha256").update(fingerprint + "|" + dateStr + "|" + role)
    .digest("hex").slice(0, 10);
}

// Crash-safety for the gate's structural-test swap (see runStructuralTests).
// That routine backs up the live content to <CONTENT_PATH>.gatebak, swaps the
// AI-applied tree in to run validators against, then ALWAYS restores in a
// finally. But a `finally` cannot run if the process is SIGKILL'd / OOM-killed
// / hard-timed-out mid-swap — which in an unattended cron could otherwise leave
// AI-drafted content sitting in the live data file. This guard runs FIRST on
// every invocation: if a stray .gatebak exists, a prior gate was interrupted,
// so we restore the real live content from it before doing anything else. The
// backup is the pre-swap live file, so restoring it is always the safe choice.
// Idempotent and dependency-free (Node built-ins only).
function selfHealGatebak() {
  const backupPath = CONTENT_PATH + ".gatebak";
  try {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, CONTENT_PATH); // restore pre-swap live content
      fs.unlinkSync(backupPath);
      console.warn("[editorial] self-heal: restored live content from stray .gatebak " +
        "(a previous gate run was interrupted mid-swap).");
    }
  } catch (e) {
    // Never let the guard itself break a run; surface it loudly instead.
    console.error("[editorial] self-heal could not restore .gatebak: " + e.message);
  }
}

function selectModel(registry, role, action) {
  const r = registry.roles && registry.roles[role];
  if (!r) throw new Error("no registry role: " + role);
  const wantId = (action === "downgrade" || action === "stop") ? r.downgrade : r.default;
  const cand = (r.candidates || []).find((c) => c.id === wantId) || (r.candidates || [])[0];
  const reason = (action === "downgrade" || action === "stop")
    ? "downgrade — budget at/over downgrade threshold"
    : "default — budget under thresholds";
  return { id: cand.id, est: Number(cand.est_cost_per_run_usd) || 0, reason };
}

function loadCommon() {
  const config = readJSONSafe(CONFIG_PATH);
  const registry = readJSONSafe(REGISTRY_PATH);
  const ledger = readJSONSafe(LEDGER_PATH) || { entries: [], months: {} };
  if (!config || !registry) { console.error("[editorial] missing config/registry."); process.exit(3); }
  return { config, registry, ledger };
}

function gate(config) {
  const phase = Number(config.editorial_automation_phase) || 0;
  const enabled = !(config.kill_switch && config.kill_switch.editorial_automation_enabled === false);
  return { phase, enabled };
}

// Common precondition for any drafting/validation work.
function requireActiveTaskWithFindings() {
  const task = readJSONSafe(TASK_PATH);
  const findings = readJSONSafe(FINDINGS_PATH);
  if (!task || task.decision !== "DRAFT") {
    return { ok: false, reason: "no DRAFT task", task, findings };
  }
  if (!findings || findings.fingerprint !== task.fingerprint) {
    return { ok: false, reason: "no research findings for this fingerprint (run Phase 1 research first)", task, findings };
  }
  return { ok: true, task, findings };
}

function appendSpend(ledger, role, model, est, ids) {
  budget.appendEntry(ledger, {
    ts: new Date().toISOString(),
    month: budget.currentMonth(new Date()),
    role,
    model: model || "unknown",
    estimated_cost_usd: budget.round2(est),
    run_id: ids.run_id,
    task_id: ids.task_id,
    fingerprint: ids.fingerprint
  });
  writeJSON(LEDGER_PATH, ledger);
}

// --------------------------------------------------------------- DRAFT PREP ---
function cmdDraftPrep() {
  const { config, registry, ledger } = loadCommon();
  const { phase, enabled } = gate(config);
  if (phase < 2 || !enabled) {
    console.log(JSON.stringify({ actionable: false, reason: "phase<2 or disabled", phase, enabled }));
    process.exit(4);
  }
  const pre = requireActiveTaskWithFindings();
  if (!pre.ok) { console.log(JSON.stringify({ actionable: false, reason: pre.reason })); process.exit(3); }

  // Idempotency: a draft already exists for this fingerprint.
  const existing = readJSONSafe(DRAFT_PATH);
  if (existing && existing.fingerprint === pre.task.fingerprint) {
    console.log(JSON.stringify({ actionable: false, reason: "draft already exists for fingerprint", fingerprint: pre.task.fingerprint }));
    process.exit(0);
  }

  const status = budget.computeStatus(config, ledger, { now: new Date() });
  if (status.action === "stop") {
    console.log(JSON.stringify({ actionable: false, reason: "budget stop — hard cap reached", budget: status }));
    process.exit(4);
  }

  const model = selectModel(registry, "editorial", status.action);
  const dateStr = isoDate();
  const run_id = makeId(pre.task.fingerprint, dateStr, "editorial");
  const liveContent = readJSONSafe(CONTENT_PATH);

  const prep = {
    actionable: true,
    stage: "draft",
    run_id,
    date: dateStr,
    editorial_date: dateStr,
    phase,
    shadow_mode: config.shadow_mode !== false,
    role: "editorial",
    model: model.id,
    model_selection_reason: model.reason,
    estimated_cost_usd: model.est,
    budget_action: status.action,
    budget: status,
    prompt_contract: "automation/prompts/editorial.md",
    draft_schema: "automation/schemas/content-draft.schema.json",
    editable_fields_map: "automation/editable-fields-map.md",
    task: pre.task,
    findings: pre.findings,
    live_content: liveContent
  };
  console.log(JSON.stringify(prep, null, 2));
  process.exit(0);
}

// ------------------------------------------------------------- DRAFT INGEST ---
function cmdDraftIngest(candidatePath) {
  const { config, registry, ledger } = loadCommon();
  const { phase } = gate(config);
  const pre = requireActiveTaskWithFindings();
  if (!pre.ok) { console.error("[editorial] " + pre.reason); process.exit(3); }

  const candidate = readJSONSafe(candidatePath);
  if (!candidate) { console.error("[editorial] cannot read candidate draft: " + candidatePath); process.exit(2); }

  const dateStr = isoDate();
  const run_id = makeId(pre.task.fingerprint, dateStr, "editorial");

  // Stamp provenance the runner owns.
  candidate.schema_version = "1.0.0";
  candidate.task_id = pre.task.task_id;
  candidate.fingerprint = pre.task.fingerprint;
  candidate.findings_id = pre.findings.findings_id;
  candidate.phase = phase;
  candidate.shadow_mode = config.shadow_mode !== false;
  candidate.model_role = "editorial";
  if (!candidate.draft_id) candidate.draft_id = "draft-" + pre.task.fingerprint;
  if (!candidate.generated_at) candidate.generated_at = new Date().toISOString();
  if (!candidate.editorial_date) candidate.editorial_date = dateStr;
  if (candidate.estimated_cost_usd == null) {
    candidate.estimated_cost_usd = selectModel(registry, "editorial", "proceed").est;
  }

  const schema = readJSONSafe(DRAFT_SCHEMA);
  const res = validate(candidate, schema);
  if (!res.valid) {
    console.error("[editorial] candidate draft FAILED schema validation; refusing to write:");
    res.errors.forEach((e) => console.error("  · " + e.path + ": " + e.message));
    process.exit(2);
  }

  writeJSON(DRAFT_PATH, candidate);
  appendSpend(ledger, "editorial", candidate.model_used, candidate.estimated_cost_usd,
    { run_id, task_id: pre.task.task_id, fingerprint: pre.task.fingerprint });

  console.log("[editorial] OK draft written.");
  console.log("  draft  -> " + path.relative(ROOT, DRAFT_PATH));
  console.log("  ledger -> +$" + budget.round2(candidate.estimated_cost_usd) + " (model " + (candidate.model_used || "unknown") + ")");
  process.exit(0);
}

// ------------------------------------------------------------ VALIDATE PREP ---
function cmdValidatePrep() {
  const { config, registry, ledger } = loadCommon();
  const { phase, enabled } = gate(config);
  if (phase < 2 || !enabled) {
    console.log(JSON.stringify({ actionable: false, reason: "phase<2 or disabled", phase, enabled }));
    process.exit(4);
  }
  const pre = requireActiveTaskWithFindings();
  if (!pre.ok) { console.log(JSON.stringify({ actionable: false, reason: pre.reason })); process.exit(3); }
  const draft = readJSONSafe(DRAFT_PATH);
  if (!draft || draft.fingerprint !== pre.task.fingerprint) {
    console.log(JSON.stringify({ actionable: false, reason: "no draft for this fingerprint (run --draft first)" }));
    process.exit(3);
  }

  const status = budget.computeStatus(config, ledger, { now: new Date() });
  if (status.action === "stop") {
    console.log(JSON.stringify({ actionable: false, reason: "budget stop — hard cap reached", budget: status }));
    process.exit(4);
  }

  const model = selectModel(registry, "validation", status.action);
  const dateStr = isoDate();
  const report_id = makeId(pre.task.fingerprint, dateStr, "validation");
  const liveContent = readJSONSafe(CONTENT_PATH);

  const prep = {
    actionable: true,
    stage: "validate",
    report_id,
    date: dateStr,
    phase,
    role: "validation",
    model: model.id,
    model_selection_reason: model.reason,
    estimated_cost_usd: model.est,
    budget_action: status.action,
    prompt_contract: "automation/prompts/validation.md",
    quality_schema: "automation/schemas/quality-report.schema.json",
    task: pre.task,
    findings: pre.findings,
    draft,
    live_content: liveContent
  };
  console.log(JSON.stringify(prep, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------- VALIDATE INGEST ---
function cmdValidateIngest(candidatePath) {
  const { config, registry, ledger } = loadCommon();
  const pre = requireActiveTaskWithFindings();
  if (!pre.ok) { console.error("[editorial] " + pre.reason); process.exit(3); }

  const candidate = readJSONSafe(candidatePath);
  if (!candidate) { console.error("[editorial] cannot read candidate validation: " + candidatePath); process.exit(2); }

  // Validate just the validation_agent sub-shape.
  const qschema = readJSONSafe(QUALITY_SCHEMA);
  const subSchema = qschema.properties.validation_agent;
  const res = validate(candidate, subSchema);
  if (!res.valid) {
    console.error("[editorial] candidate validation FAILED schema validation; refusing to write:");
    res.errors.forEach((e) => console.error("  · " + e.path + ": " + e.message));
    process.exit(2);
  }

  const dateStr = isoDate();
  const report_id = makeId(pre.task.fingerprint, dateStr, "validation");
  if (candidate.estimated_cost_usd == null) {
    candidate.estimated_cost_usd = selectModel(registry, "validation", "proceed").est;
  }
  writeJSON(VALIDATION_STASH, candidate);
  // A fresh single-judge ingest supersedes any stale panel stash so the gate
  // treats THIS as the (1-judge) panel.
  try { if (fs.existsSync(VALIDATION_PANEL_STASH)) fs.unlinkSync(VALIDATION_PANEL_STASH); } catch (e) { /* ignore */ }
  appendSpend(ledger, "validation", candidate.model_used, candidate.estimated_cost_usd,
    { run_id: report_id, task_id: pre.task.task_id, fingerprint: pre.task.fingerprint });

  console.log("[editorial] OK validation stashed for gate.");
  console.log("  confidence -> " + candidate.confidence + " grade -> " + candidate.reading_grade);
  console.log("  ledger -> +$" + budget.round2(candidate.estimated_cost_usd) + " (model " + (candidate.model_used || "unknown") + ")");
  process.exit(0);
}

// -------------------------------------------------- VALIDATE PANEL INGEST ----
// Phase 3: ingest an ARRAY of N judge quality-report-shaped objects (the 3-model
// adversarial panel). Validates each against the validation_agent sub-schema (one
// corrective pass on schema failure, same pattern as --validate-ingest), then
// stashes the whole array at data/pulse-validation-panel.json for the gate. The
// single --validate-ingest path stays working (treated as a 1-judge panel by the
// gate's loadPanel).
function cmdValidatePanelIngest(candidatePath) {
  const { config, registry, ledger } = loadCommon();
  const pre = requireActiveTaskWithFindings();
  if (!pre.ok) { console.error("[editorial] " + pre.reason); process.exit(3); }

  const raw = readJSONSafe(candidatePath);
  if (!raw) { console.error("[editorial] cannot read candidate panel: " + candidatePath); process.exit(2); }
  // Accept either a bare array or an object { judges: [...] }.
  const judges = Array.isArray(raw) ? raw : (Array.isArray(raw.judges) ? raw.judges : null);
  if (!judges || judges.length === 0) {
    console.error("[editorial] panel ingest expects a non-empty JSON array of judge objects (or { judges: [...] })");
    process.exit(2);
  }

  const qschema = readJSONSafe(QUALITY_SCHEMA);
  const subSchema = qschema.properties.validation_agent;
  for (let i = 0; i < judges.length; i++) {
    const res = validate(judges[i], subSchema);
    if (!res.valid) {
      console.error("[editorial] panel judge[" + i + "] FAILED schema validation; refusing to write:");
      res.errors.forEach((e) => console.error("  · " + e.path + ": " + e.message));
      process.exit(2);
    }
  }

  const panelCfg = (config.validation_panel) || {};
  const minRequired = Number(panelCfg.min_required) || 1;
  if (judges.length < minRequired) {
    console.error("[editorial] panel has " + judges.length + " judge(s) but min_required is " + minRequired);
    process.exit(2);
  }

  const dateStr = isoDate();
  const report_id = makeId(pre.task.fingerprint, dateStr, "validation-panel");
  const stash = { judges, generated_at: new Date().toISOString(), fingerprint: pre.task.fingerprint };
  writeJSON(VALIDATION_PANEL_STASH, stash);

  // ledger: one entry per judge (each is a real model run).
  judges.forEach((j) => {
    const est = j.estimated_cost_usd != null ? j.estimated_cost_usd
      : selectModel(registry, "validation", "proceed").est;
    appendSpend(ledger, "validation", j.model_used, est,
      { run_id: report_id, task_id: pre.task.task_id, fingerprint: pre.task.fingerprint });
  });

  console.log("[editorial] OK validation panel stashed for gate (" + judges.length + " judges).");
  judges.forEach((j) => console.log("  · " + (j.model_used || "?") + " conf=" + j.confidence));
  console.log("  panel -> " + path.relative(ROOT, VALIDATION_PANEL_STASH));
  process.exit(0);
}

// Load the panel for the gate. Source of truth is the panel stash (array of
// judges). For backward compat, if no panel stash exists but a single validation
// candidate does, treat that single object as a 1-judge panel. Returns
// { judges: [...] } or null if neither exists.
function loadPanel() {
  const panel = readJSONSafe(VALIDATION_PANEL_STASH);
  if (panel && Array.isArray(panel.judges) && panel.judges.length) return { judges: panel.judges };
  const single = readJSONSafe(VALIDATION_STASH);
  if (single) return { judges: [single] };
  return null;
}

// Compute the panel-derived numbers the gate needs from a list of judges.
// A judge has a "hard issue" if it reports disclaimer not respected, an overclaim,
// any unsupported (causal) claim, or an unacknowledged narrative reversal (the
// last is only counted as hard when a reversal actually exists — see cmdGate,
// which passes reversalExists). Returns the worst/representative judge too.
function summarizePanel(judges, publishBar, reversalExists) {
  let minConf = Infinity;
  let worst = judges[0];
  let allClear = true;
  let anyHard = false;
  judges.forEach((j) => {
    const c = Number(j.confidence);
    if (c < minConf) { minConf = c; worst = j; }
    if (c < publishBar) allClear = false;
    const hard =
      j.disclaimer_respected === false ||
      j.honest_no_overclaim === false ||
      (Array.isArray(j.unsupported_claims) && j.unsupported_claims.length > 0) ||
      (reversalExists && j.narrative_reversal_acknowledged === false);
    if (hard) anyHard = true;
  });
  if (!isFinite(minConf)) minConf = 0;
  return { minConf, worst, allClear, anyHard };
}

// True iff EVERY judge explicitly acknowledged the (supported) narrative reversal.
function panelAcknowledgedReversal(judges) {
  return judges.every((j) => j.narrative_reversal_acknowledged !== false);
}

// ----------------------------------------------------- POST-PUBLISH VERIFY ----
// Called by the CRON AFTER it pushes an auto-published commit to main. Reads the
// just-published live content (data/pulse-content.json) and confirms the live site
// actually serves it. DETECTION ONLY — this never reverts or pushes; the cron acts
// on the exit code. Exit 0 = live matches; exit 6 = live does NOT match after
// retries; exit 3 = nothing to verify. Supports --retries / --backoff-ms / --url.
function cmdPostPublishVerify(args) {
  const expected = readJSONSafe(CONTENT_PATH);
  if (!expected) { console.error("[editorial] no content to verify at " + path.relative(ROOT, CONTENT_PATH)); process.exit(3); }

  function flag(name, def) {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] != null ? args[i + 1] : def;
  }
  const url = flag("--url", undefined);
  const retries = Number(flag("--retries", 5));
  const backoffMs = Number(flag("--backoff-ms", 30000));

  postPublishCheck.verifyLive(expected, { url, retries, backoffMs })
    .then((result) => {
      console.log(JSON.stringify({
        ok: result.ok,
        reason: result.reason,
        http_status: result.http_status,
        matched: result.matched,
        attempts: result.attempts,
        url: url || postPublishCheck.DEFAULT_URL
      }));
      process.exit(result.ok ? 0 : 6);
    })
    .catch((e) => {
      console.log(JSON.stringify({ ok: false, reason: "verify_exception: " + e.message, http_status: 0, matched: false }));
      process.exit(6);
    });
}

// ------------------------------------------------- CLASSIFY MATERIALITY ----
// Tier-3 routing probe the cron runs Mon–Thu. Deterministic, NO AI, NO writes.
// Reads the latest decision + the registry, asks the materiality classifier
// whether any data move clears the conservative editorial-exception threshold,
// prints the classifier JSON, and signals the cron via the exit code:
//   0 = classified OK and any_material=true  (an off-cycle exception WOULD be warranted)
//   3 = classified OK and any_material=false (no material move — hold for Friday)
//   2 = could not classify (missing/invalid decision or registry)
function cmdClassifyMateriality(args) {
  const decision = readJSONSafe(DECISION_PATH);
  const registry = readJSONSafe(REGISTRY_DATA_PATH);
  if (!decision || !registry || !Array.isArray(registry.signals)) {
    console.error(JSON.stringify({
      ok: false,
      reason: "could not classify — missing/invalid decision or registry",
      decision_readable: !!decision,
      registry_readable: !!(registry && Array.isArray(registry.signals))
    }, null, 2));
    process.exit(2);
  }

  // Optional --derived-fraction <n> override (defaults to the module's 0.35).
  let fraction;
  const fi = args.indexOf("--derived-fraction");
  if (fi !== -1 && args[fi + 1] != null) {
    const f = Number(args[fi + 1]);
    if (Number.isFinite(f)) fraction = f;
  }

  const result = materiality.classifyMateriality(decision, registry,
    fraction != null ? { derived_fraction: fraction } : {});
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.any_material ? 0 : 3);
}

// -------------------------------------------------------------------- GATE ----
function cmdGate() {
  const { config, registry, ledger } = loadCommon();
  const { phase, enabled } = gate(config);
  const pre = requireActiveTaskWithFindings();
  if (!pre.ok) { console.error("[editorial] " + pre.reason); process.exit(3); }

  const draft = readJSONSafe(DRAFT_PATH);
  const panel = loadPanel();
  const liveContent = readJSONSafe(CONTENT_PATH);
  const dataRegistry = readJSONSafe(REGISTRY_DATA_PATH);
  if (!draft || draft.fingerprint !== pre.task.fingerprint) { console.error("[editorial] no draft for fingerprint"); process.exit(3); }
  if (!panel) { console.error("[editorial] no validation candidate (run --validate-ingest or --validate-panel-ingest first)"); process.exit(3); }
  const judges = panel.judges;
  // The worst/representative judge populates the backward-compat validation_agent
  // block; the panel summary below drives the verdict + publish decision.
  const validation = judges.reduce((w, j) => (Number(j.confidence) < Number(w.confidence) ? j : w), judges[0]);

  const now = new Date();
  const dateStr = isoDate(now);
  const report_id = makeId(pre.task.fingerprint, dateStr, "gate");

  const greenConf = Number(config.confidence_threshold) || 0.9;
  const gradeMax = Number(config.reading_grade_target_max) || 9;
  const yellowConf = 0.70;
  const publishBar = Number(config.publish_confidence_threshold) || 0.95;
  const blocking = [];

  // ---- layer 1: deterministic reconciler ----
  const rec = verifyClaims.verifyDraft(draft, liveContent, dataRegistry, { now });
  if (!rec.pass) {
    rec.hard_failures.forEach((f) => blocking.push("reconciler:" + f.check + " — " + f.detail));
  }

  // ---- layer 3 (structural): apply to a COPY, diff guard, validate data, run tests ----
  let editorialOnlyDiff = false;
  let testsPass = false;
  const failedTests = [];
  let draftSchemaValid = true;

  const dsRes = validate(draft, readJSONSafe(DRAFT_SCHEMA));
  draftSchemaValid = dsRes.valid;
  if (!draftSchemaValid) {
    dsRes.errors.forEach((e) => blocking.push("schema:" + e.path + " — " + e.message));
  }

  let applied = null;
  try {
    applied = applyEditorial.applyDraft(liveContent, draft, { now });
    const guard = applyEditorial.diffGuard(liveContent, applied);
    editorialOnlyDiff = guard.ok;
    if (!guard.ok) guard.violations.forEach((v) => blocking.push("diff_guard:" + v));
  } catch (e) {
    blocking.push("apply:exception — " + e.message);
  }

  // Run data-validate + test suites against a temp copy of the APPLIED tree, so
  // we never touch the live file to test it. We write the applied content to a
  // temp path, point the validators at it via env, OR (simpler + safe) write to a
  // scratch file and run a focused recompute. The existing validators read fixed
  // paths, so we test by temporarily swapping content with a backup guard.
  if (applied && editorialOnlyDiff && draftSchemaValid) {
    const tests = runStructuralTests(applied);
    testsPass = tests.pass;
    tests.failed.forEach((t) => { failedTests.push(t); blocking.push("tests:" + t); });
  } else {
    // can't meaningfully run tests on an unsafe tree
    failedTests.push("skipped — unsafe tree (diff guard or schema failed)");
  }

  // ---- layer 1b: deterministic WHOLE-PAGE clarity + jargon scan (macro-editor gate) ----
  // Scans the APPLIED tree (post-apply, pre-publish) for unexplained economic
  // jargon and reading grade over EVERY editable prose string on the page — not
  // just the signals this cycle touched. Pure code: a generous AI grade can never
  // sneak past this floor. Unexplained jargon or grade>max anywhere = hard block.
  // Only meaningful when we actually have a safe applied tree.
  let clarity = null;
  if (applied) {
    clarity = clarityScan.scanPage(applied, { gradeMax, gateScope: "editable" });
    if (!clarity.jargon_clean) {
      clarity.unexplained_jargon.forEach((u) =>
        blocking.push("clarity:jargon \"" + u.term + "\" @ " + u.path));
    }
    if (!clarity.grade_ok) {
      blocking.push("clarity:reading_grade " + clarity.page_grade + " > " + gradeMax + " (page)");
    }
    clarity.soft_warnings.forEach((w) => blocking.push("clarity_soft:" + w.check + " — " + w.detail));
  } else {
    blocking.push("clarity:skipped — no applied tree");
  }
  const clarityClean = !!(clarity && clarity.jargon_clean && clarity.grade_ok);

  // ---- multi-fold backstop A: deterministic no-advice / no-prediction scan ----
  // Whole-page phrase-level floor over the APPLIED tree's editable prose. Any hit
  // (prescriptive advice OR a forward price/level prediction) is a HARD block — a
  // generous AI judge can never let advice slip past this deterministic floor.
  let noAdvice = null;
  if (applied) {
    noAdvice = noAdviceScan.scanNoAdvice(applied);
    if (!noAdvice.pass) {
      noAdvice.hits.forEach((h) =>
        blocking.push("no_advice:" + h.kind + " \"" + h.term + "\" @ " + h.path));
    }
  } else {
    blocking.push("no_advice:skipped — no applied tree");
  }
  const noAdviceClean = !!(noAdvice && noAdvice.pass);

  // ---- multi-fold backstop B: narrative-consistency vs the previous live page ----
  // An UNSUPPORTED reversal (prose flips, data direction did not) is a HARD block.
  // A SUPPORTED reversal is soft: it downgrades GREEN->YELLOW unless EVERY judge
  // explicitly acknowledged it (narrative_reversal_acknowledged).
  let narrative = null;
  if (applied) {
    narrative = narrativeConsistency.checkConsistency(liveContent, applied, { registry: dataRegistry });
    narrative.hard_failures.forEach((f) =>
      blocking.push("narrative_reversal_unsupported:" + f.signal_id + " — " + f.detail));
  } else {
    blocking.push("narrative:skipped — no applied tree");
  }
  const narrativeHardClean = !!(narrative && narrative.pass);
  const supportedReversalExists = !!(narrative && narrative.soft_warnings.length > 0);
  const reversalExists = !!(narrative && narrative.reversals.length > 0);

  // ---- layer 2: 3-model adversarial PANEL (worst-case confidence) ----
  const panelSummary = summarizePanel(judges, publishBar, reversalExists);
  const panelMinConf = panelSummary.minConf;
  const panelAllClearPublish = panelSummary.allClear;
  const panelAnyHardIssue = panelSummary.anyHard;
  const conf = panelMinConf; // verdict uses worst-case confidence
  // Per-judge meaning checks (reported against the worst/representative judge).
  if (validation.reading_grade > gradeMax) blocking.push("validation:reading_grade " + validation.reading_grade + " > " + gradeMax);
  if (panelAnyHardIssue) blocking.push("panel:a judge reports a hard issue (disclaimer/overclaim/unsupported-causal/unacknowledged-reversal)");
  judges.forEach((j) => {
    if (j.disclaimer_respected === false) blocking.push("panel:" + (j.model_used || "?") + " disclaimer not respected");
    if (j.honest_no_overclaim === false) blocking.push("panel:" + (j.model_used || "?") + " overclaim detected");
    if (Array.isArray(j.unsupported_claims) && j.unsupported_claims.length > 0)
      blocking.push("panel:" + (j.model_used || "?") + " reports " + j.unsupported_claims.length + " unsupported claim(s)");
  });
  if (conf < yellowConf) blocking.push("panel:min confidence " + conf + " < " + yellowConf + " (below YELLOW floor)");

  // A supported reversal that the panel did NOT all acknowledge downgrades GREEN.
  const reversalCleared = !supportedReversalExists || panelAcknowledgedReversal(judges);
  if (supportedReversalExists && !reversalCleared) {
    narrative.soft_warnings.forEach((w) =>
      blocking.push("narrative_reversal_unacknowledged:" + w.signal_id + " — " + w.detail));
  }

  // ---- verdict (deterministic) ----
  const reconcilerClean = rec.pass;
  const structuralClean = draftSchemaValid && editorialOnlyDiff && testsPass;
  const hardClean = reconcilerClean && structuralClean && clarityClean &&
    noAdviceClean && narrativeHardClean && !panelAnyHardIssue &&
    validation.disclaimer_respected !== false &&
    validation.honest_no_overclaim !== false &&
    validation.reading_grade <= gradeMax;

  let verdict;
  if (!hardClean || conf < yellowConf) {
    verdict = "RED";
  } else if (conf >= greenConf && rec.soft_warnings.length === 0 && reversalCleared) {
    verdict = "GREEN";
  } else {
    verdict = "YELLOW";
    if (conf < greenConf) blocking.push("verdict:confidence " + conf + " in YELLOW band [" + yellowConf + ", " + greenConf + ")");
    rec.soft_warnings.forEach((w) => blocking.push("soft:" + w.check + " — " + w.detail));
  }

  // ---- publish decision ----
  // Two separate bars: GREEN (>= green_confidence, default 0.90) is the verdict
  // band; auto-PUBLISH additionally requires confidence >= publish_confidence_
  // threshold (default 0.95) AND a clean whole-page clarity scan. This is the
  // user's "only auto-publish when the editor is ~95% sure" rule. Below the
  // publish bar (but still GREEN) we HOLD SILENTLY and let the next cycle retry —
  // no notification, no PR churn. A manual kill-switch (pause_auto_publish) can
  // force every cycle back to review/hold without disarming the whole pipeline.
  const autoPublishEnabled = config.auto_publish_enabled === true;
  const shadow = config.shadow_mode !== false;
  const autoPublishPaused = config.pause_auto_publish === true;
  const eligible = verdict === "GREEN";
  // Everything that must be true to actually write live content unattended. The
  // panel adds two requirements on top of the single-judge bar: the WORST judge
  // must clear the publish bar (panelMinConf >= bar, == conf here) AND ALL judges
  // must independently clear it (panelAllClearPublish). The deterministic
  // backstops (no-advice, narrative) must also be clean.
  const publishAllowed = eligible && clarityClean && noAdviceClean && narrativeHardClean &&
    conf >= publishBar && panelAllClearPublish &&
    autoPublishEnabled && enabled && !shadow && !autoPublishPaused;
  let action = "review_pr";
  let published = false;
  let hold_reason = null;
  if (verdict === "RED") {
    action = "held_safe";
  } else if (publishAllowed) {
    // THE ONLY PATH THAT TOUCHES LIVE CONTENT.
    writeJSON(CONTENT_PATH, applied);
    published = true;
    action = "auto_publish";
  } else if (autoPublishEnabled && enabled && !shadow) {
    // Auto-publish is ARMED, but this cycle did not clear the publish bar.
    // Hold silently and retry next cycle (per the user's chosen behavior).
    action = "held_below_bar";
    if (autoPublishPaused) hold_reason = "auto-publish paused by kill-switch (pause_auto_publish)";
    else if (!clarityClean) hold_reason = "clarity scan not clean (jargon/grade)";
    else if (!noAdviceClean) hold_reason = "no-advice scan not clean (advice/prediction language)";
    else if (!narrativeHardClean) hold_reason = "unsupported narrative reversal";
    else if (!panelAllClearPublish) hold_reason = "panel not unanimous >= publish bar " + publishBar + " (min " + panelMinConf + ")";
    else if (conf < publishBar) hold_reason = "panel min confidence " + conf + " < publish bar " + publishBar;
    else hold_reason = "verdict " + verdict + " (not GREEN)";
  } else {
    // Auto-publish not armed (shadow / disabled) -> review PR path.
    action = "review_pr";
  }

  // ---- assemble + write the quality report ----
  const report = {
    schema_version: "1.0.0",
    report_id,
    task_id: pre.task.task_id,
    fingerprint: pre.task.fingerprint,
    draft_id: draft.draft_id,
    generated_at: now.toISOString(),
    phase,
    verdict,
    reconciler: {
      pass: rec.pass,
      numbers_ok: rec.numbers_ok,
      polarity_ok: rec.polarity_ok,
      narrative_ok: rec.narrative_ok,
      advice_clean: rec.advice_clean,
      freshness_ok: rec.freshness_ok,
      hard_failures: rec.hard_failures,
      soft_warnings: rec.soft_warnings,
      unreconciled_numbers: rec.unreconciled_numbers
    },
    validation_agent: {
      model_used: validation.model_used,
      confidence: Number(validation.confidence),
      reading_grade: validation.reading_grade,
      one_voice_cohesion: validation.one_voice_cohesion !== false,
      honest_no_overclaim: validation.honest_no_overclaim !== false,
      disclaimer_respected: validation.disclaimer_respected !== false,
      unsupported_claims: validation.unsupported_claims || [],
      narrative_reversal_acknowledged: validation.narrative_reversal_acknowledged !== false,
      estimated_cost_usd: validation.estimated_cost_usd != null ? validation.estimated_cost_usd : 0,
      notes: validation.notes || ""
    },
    validation_panel: {
      judges: judges.map((j) => ({
        model_used: j.model_used,
        confidence: Number(j.confidence),
        disclaimer_respected: j.disclaimer_respected !== false,
        honest_no_overclaim: j.honest_no_overclaim !== false,
        one_voice_cohesion: j.one_voice_cohesion !== false,
        unsupported_claims: j.unsupported_claims || [],
        narrative_reversal_acknowledged: j.narrative_reversal_acknowledged !== false,
        reading_grade: j.reading_grade != null ? j.reading_grade : 0,
        notes: j.notes || ""
      })),
      min_confidence: panelMinConf,
      all_clear_publish: panelAllClearPublish,
      any_hard_issue: panelAnyHardIssue
    },
    no_advice: noAdvice ? {
      pass: noAdvice.pass,
      hits: noAdvice.hits,
      sections_scanned: noAdvice.sections_scanned
    } : { pass: false, hits: [], sections_scanned: 0 },
    narrative_consistency: narrative ? {
      pass: narrative.pass,
      reversals: narrative.reversals,
      soft_warnings: narrative.soft_warnings,
      hard_failures: narrative.hard_failures
    } : { pass: false, reversals: [], soft_warnings: [], hard_failures: [] },
    structural: {
      draft_schema_valid: draftSchemaValid,
      editorial_only_diff: editorialOnlyDiff,
      tests_pass: testsPass,
      failed_tests: failedTests
    },
    clarity: clarity ? {
      gate_scope: clarity.gate_scope,
      jargon_clean: clarity.jargon_clean,
      grade_ok: clarity.grade_ok,
      page_grade: clarity.page_grade,
      hardest_sentence_grade: clarity.hardest_sentence_grade,
      hardest_sentence_path: clarity.hardest_sentence_path,
      sections_scanned: clarity.sections_scanned,
      unexplained_jargon: clarity.unexplained_jargon,
      explained_jargon: clarity.explained_jargon,
      readonly_jargon: clarity.readonly_jargon
    } : {
      gate_scope: "editable",
      jargon_clean: false,
      grade_ok: false,
      page_grade: 0,
      hardest_sentence_grade: 0,
      hardest_sentence_path: "",
      sections_scanned: 0,
      unexplained_jargon: [],
      explained_jargon: [],
      readonly_jargon: []
    },
    thresholds: {
      green_confidence: greenConf,
      yellow_confidence: yellowConf,
      publish_confidence: publishBar,
      reading_grade_max: gradeMax
    },
    blocking_reasons: blocking,
    auto_publish: {
      eligible,
      enabled_in_config: autoPublishEnabled,
      paused: autoPublishPaused,
      publish_bar: publishBar,
      clarity_clean: clarityClean,
      panel_all_clear: panelAllClearPublish,
      panel_min_confidence: panelMinConf,
      published,
      action,
      hold_reason: hold_reason
    }
  };

  const qRes = validate(report, readJSONSafe(QUALITY_SCHEMA));
  if (!qRes.valid) {
    console.error("[editorial] quality report failed schema validation:");
    qRes.errors.forEach((e) => console.error("  · " + e.path + ": " + e.message));
    process.exit(2);
  }
  writeJSON(REPORT_PATH, report);

  // run record
  const record = {
    schema_version: "1.0.0",
    run_id: report_id,
    started_at: now.toISOString(),
    finished_at: new Date().toISOString(),
    phase,
    shadow_mode: shadow,
    role: "validation",
    model_used: validation.model_used || "unknown",
    model_selection_reason: "gate (deterministic verdict)",
    task_id: pre.task.task_id,
    fingerprint: pre.task.fingerprint,
    trigger_summary: "GATE verdict=" + verdict + " action=" + action,
    estimated_cost_usd: 0,
    budget_status: (function () {
      const s = budget.computeStatus(config, ledger, { now });
      return { month: s.month, spent_before_usd: s.spent_usd, monthly_target_usd: s.monthly_target_usd,
        hard_cap_usd: s.hard_cap_usd, pct_of_cap: s.pct_of_cap, action: s.action };
    })(),
    outputs: {
      findings_path: path.relative(ROOT, FINDINGS_PATH),
      content_draft_path: path.relative(ROOT, DRAFT_PATH),
      quality_report_path: path.relative(ROOT, REPORT_PATH)
    },
    outcome: "completed",
    error: null
  };
  const rRes = validate(record, readJSONSafe(RUN_SCHEMA));
  if (rRes.valid) {
    if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
    writeJSON(path.join(RUNS_DIR, dateStr + "-" + report_id + ".json"), record);
  }

  console.log("[editorial] GATE verdict=" + verdict + " action=" + action + " published=" + published +
    (hold_reason ? " hold_reason=\"" + hold_reason + "\"" : ""));
  console.log("  reconciler: " + (rec.pass ? "clean" : "FAIL") +
    " | schema:" + draftSchemaValid + " diff_guard:" + editorialOnlyDiff + " tests:" + testsPass +
    " | clarity:" + (clarity ? (clarityClean ? "clean(grade " + clarity.page_grade + ")" : "FAIL(" + clarity.unexplained_jargon.length + " jargon, grade " + clarity.page_grade + ")") : "n/a") +
    " | no_advice:" + (noAdvice ? (noAdviceClean ? "clean" : "FAIL(" + noAdvice.hits.length + ")") : "n/a") +
    " | narrative:" + (narrative ? (narrativeHardClean ? (supportedReversalExists ? "soft-reversal" : "clean") : "FAIL(" + narrative.hard_failures.length + ")") : "n/a") +
    " | panel:" + judges.length + "j min=" + panelMinConf + " all_clear=" + panelAllClearPublish + " hard=" + panelAnyHardIssue +
    " (green>=" + greenConf + ", publish>=" + publishBar + ")");
  if (blocking.length) { console.log("  blocking:"); blocking.forEach((b) => console.log("   · " + b)); }
  console.log("  report -> " + path.relative(ROOT, REPORT_PATH));

  if (verdict === "RED") process.exit(5);
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
// Run data-validate + the 5 test suites against an APPLIED content tree WITHOUT
// touching the live file: write applied content to a temp copy, back up the live
// file, swap, run the validators (which read fixed paths), then ALWAYS restore.
function runStructuralTests(appliedContent) {
  const failed = [];
  const backupPath = CONTENT_PATH + ".gatebak";
  let swapped = false;
  try {
    fs.copyFileSync(CONTENT_PATH, backupPath);
    writeJSON(CONTENT_PATH, appliedContent);
    swapped = true;

    // data-validate --check (the CI gate). exit 1 on hard failure.
    try {
      execFileSync("node", [path.join(ROOT, "scripts", "validate-pulse-data.js"), "--check"],
        { cwd: ROOT, stdio: "pipe" });
    } catch (e) {
      failed.push("validate-pulse-data --check");
    }

    // the 5 test suites
    const testDir = path.join(ROOT, "scripts", "test");
    const suites = fs.existsSync(testDir)
      ? fs.readdirSync(testDir).filter((f) => /^test-.*\.js$/.test(f))
      : [];
    suites.forEach((suite) => {
      try {
        execFileSync("node", [path.join(testDir, suite)], { cwd: ROOT, stdio: "pipe" });
      } catch (e) {
        failed.push(suite);
      }
    });
  } catch (e) {
    failed.push("structural-harness:" + e.message);
  } finally {
    if (swapped && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, CONTENT_PATH); // ALWAYS restore live content
    }
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  }
  return { pass: failed.length === 0, failed };
}

function main() {
  const a = process.argv;
  // Crash-recovery FIRST: undo any interrupted gate swap before any command runs.
  selfHealGatebak();
  if (a.indexOf("--draft-prep") !== -1) return cmdDraftPrep();
  let i = a.indexOf("--draft-ingest");
  if (i !== -1) return cmdDraftIngest(a[i + 1]);
  if (a.indexOf("--validate-prep") !== -1) return cmdValidatePrep();
  i = a.indexOf("--validate-panel-ingest");
  if (i !== -1) return cmdValidatePanelIngest(a[i + 1]);
  i = a.indexOf("--validate-ingest");
  if (i !== -1) return cmdValidateIngest(a[i + 1]);
  if (a.indexOf("--post-publish-verify") !== -1) return cmdPostPublishVerify(a);
  if (a.indexOf("--classify-materiality") !== -1) return cmdClassifyMateriality(a);
  if (a.indexOf("--gate") !== -1) return cmdGate();
  console.error("usage: editorial-runner.js --draft-prep | --draft-ingest <f> | --validate-prep | --validate-ingest <f> | --validate-panel-ingest <f> | --gate | --classify-materiality [--derived-fraction N] | --post-publish-verify [--url U] [--retries N] [--backoff-ms M]");
  process.exit(1);
}

main();
