#!/usr/bin/env node
/* =============================================================================
   research-runner.js — Computer-side orchestrator for the Pulse research agent
   -----------------------------------------------------------------------------
   IMPORTANT: This script runs in PERPLEXITY COMPUTER, not in the GitHub Actions
   pipeline. It is intentionally kept here in the repo so the whole automation is
   reviewable and auditable in one place, but the GitHub workflow never invokes
   it. It is dependency-free (Node built-ins + the local schema validator only).
   The ACTUAL research/reasoning is performed by an AI subagent in Computer; this
   script does everything around that step: read the task, enforce idempotency,
   consult the budget governor, select a model from the provider-agnostic
   registry, VALIDATE the AI's findings against the schema, and write the three
   audit artifacts (findings, run record, ledger entry).

   Two-step design keeps AI cleanly separated from deterministic I/O:

     1) node automation/research-runner.js --prep
            Reads the pending task, checks phase/kill-switch/idempotency/budget,
            selects the model, and prints a JSON "prep" payload (task context +
            chosen model + run_id + budget action). The Computer agent reads this,
            does the research per automation/prompts/research.md, and writes a
            candidate findings file.

     2) node automation/research-runner.js --ingest <candidate-findings.json>
            Validates the candidate findings against the schema, stamps run/cost
            metadata, writes data/pulse-research-findings.json, writes
            automation/runs/<date>-<run_id>.json, appends the cost to the ledger,
            and marks the task completed. Refuses to write invalid findings.

   Shadow mode (Phase 1): NOTHING is published or merged. All three outputs are
   reviewable files on the feature branch / artifact only.

   Exit codes: 0 success / skipped; 2 = invalid findings on ingest; 3 = no
   actionable task; 4 = blocked (disabled / budget stop). Never publishes.
   ===========================================================================*/
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { validate } = require("../scripts/lib/schema-validate");
const budget = require("../scripts/check-budget.js");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "automation", "automation-config.json");
const REGISTRY_PATH = path.join(ROOT, "automation", "model-registry.json");
const LEDGER_PATH = path.join(ROOT, "automation", "spend-ledger.json");
const RUNS_DIR = path.join(ROOT, "automation", "runs");
const TASK_PATH = path.join(ROOT, "data", "pulse-editorial-task.json");
const FINDINGS_PATH = path.join(ROOT, "data", "pulse-research-findings.json");
const FINDINGS_SCHEMA = path.join(ROOT, "automation", "schemas", "research-findings.schema.json");
const RUN_SCHEMA = path.join(ROOT, "automation", "schemas", "run-record.schema.json");

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function readJSONSafe(p) { try { return readJSON(p); } catch (e) { return null; } }
function isoDate(d) { return (d || new Date()).toISOString().slice(0, 10); }

// Deterministic run id from fingerprint + day, so re-prep of the same task is stable.
function makeRunId(fingerprint, dateStr) {
  return crypto.createHash("sha256").update(fingerprint + "|" + dateStr + "|research")
    .digest("hex").slice(0, 10);
}

// Select model for a role honoring the budget action (proceed=default, downgrade/stop=downgrade).
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
  if (!config || !registry) { console.error("[runner] missing config/registry."); process.exit(3); }
  return { config, registry, ledger };
}

function gate(config) {
  const phase = Number(config.editorial_automation_phase) || 0;
  const enabled = !(config.kill_switch && config.kill_switch.editorial_automation_enabled === false);
  return { phase, enabled };
}

// ---------------------------------------------------------------- PREP --------
function cmdPrep() {
  const { config, registry, ledger } = loadCommon();
  const { phase, enabled } = gate(config);

  if (phase < 1 || !enabled) {
    console.log(JSON.stringify({ actionable: false, reason: "phase<1 or disabled", phase, enabled }));
    process.exit(4);
  }

  const task = readJSONSafe(TASK_PATH);
  if (!task || task.decision !== "DRAFT" || task.status !== "pending") {
    console.log(JSON.stringify({ actionable: false, reason: "no pending DRAFT task", task_status: task && task.status }));
    process.exit(3);
  }

  // Idempotency: findings already exist for this fingerprint -> nothing to do.
  const existing = readJSONSafe(FINDINGS_PATH);
  if (existing && existing.fingerprint === task.fingerprint) {
    console.log(JSON.stringify({ actionable: false, reason: "findings already exist for fingerprint", fingerprint: task.fingerprint }));
    process.exit(0);
  }

  const status = budget.computeStatus(config, ledger, { now: new Date() });
  if (status.action === "stop") {
    // Hard cap: do NOT spend on new drafting. (Factual data pipeline is unaffected; that's separate.)
    console.log(JSON.stringify({ actionable: false, reason: "budget stop — hard cap reached", budget: status }));
    process.exit(4);
  }

  const model = selectModel(registry, "research", status.action);
  const dateStr = isoDate();
  const run_id = makeRunId(task.fingerprint, dateStr);

  const prep = {
    actionable: true,
    run_id,
    date: dateStr,
    phase,
    shadow_mode: config.shadow_mode !== false,
    role: "research",
    model: model.id,
    model_selection_reason: model.reason,
    estimated_cost_usd: model.est,
    budget_action: status.action,
    budget: status,
    prompt_contract: "automation/prompts/research.md",
    findings_schema: "automation/schemas/research-findings.schema.json",
    task // full task context for the agent
  };
  console.log(JSON.stringify(prep, null, 2));
  process.exit(0);
}

// -------------------------------------------------------------- INGEST --------
function cmdIngest(candidatePath) {
  const { config, registry, ledger } = loadCommon();
  const { phase } = gate(config);

  const task = readJSONSafe(TASK_PATH);
  if (!task) { console.error("[runner] no task to attach findings to."); process.exit(3); }

  const candidate = readJSONSafe(candidatePath);
  if (!candidate) { console.error("[runner] cannot read candidate findings: " + candidatePath); process.exit(2); }

  const dateStr = isoDate();
  const run_id = makeRunId(task.fingerprint, dateStr);
  const startedAt = candidate.generated_at || new Date().toISOString();

  // Stamp/repair required provenance fields the runner owns (don't trust the agent for these).
  candidate.schema_version = "1.0.0";
  candidate.task_id = task.task_id;
  candidate.fingerprint = task.fingerprint;
  candidate.phase = phase;
  candidate.shadow_mode = config.shadow_mode !== false; // forced true in Phase 1
  candidate.model_role = "research";
  if (!candidate.findings_id) candidate.findings_id = "findings-" + task.fingerprint;
  if (!candidate.generated_at) candidate.generated_at = new Date().toISOString();
  if (candidate.estimated_cost_usd == null) {
    const m = selectModel(registry, "research", "proceed");
    candidate.estimated_cost_usd = m.est;
  }

  // VALIDATE — refuse to write invalid findings.
  const fSchema = readJSONSafe(FINDINGS_SCHEMA);
  const res = validate(candidate, fSchema);
  if (!res.valid) {
    console.error("[runner] candidate findings FAILED schema validation; refusing to write:");
    res.errors.forEach((e) => console.error("  · " + e.path + ": " + e.message));
    process.exit(2);
  }

  // Write findings (shadow artifact only).
  fs.writeFileSync(FINDINGS_PATH, JSON.stringify(candidate, null, 2) + "\n");

  // Budget status BEFORE this run, then append the spend entry via the governor.
  const statusBefore = budget.computeStatus(config, ledger, { now: new Date() });
  budget.appendEntry(ledger, {
    ts: new Date().toISOString(),
    month: budget.currentMonth(new Date()),
    role: "research",
    model: candidate.model_used || "unknown",
    estimated_cost_usd: budget.round2(candidate.estimated_cost_usd),
    run_id,
    task_id: task.task_id,
    fingerprint: task.fingerprint
  });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");

  // Write the immutable run record.
  const trigSummary = (task.triggers || [])
    .map((t) => t.type + (t.signals ? " [" + t.signals.map((s) => s.id + " " + s.from + "->" + s.to).join("; ") + "]" : ""))
    .join(" | ") || "DRAFT";

  const record = {
    schema_version: "1.0.0",
    run_id,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    phase,
    shadow_mode: candidate.shadow_mode,
    role: "research",
    model_used: candidate.model_used || "unknown",
    model_selection_reason: candidate._model_selection_reason || "default — budget under thresholds",
    task_id: task.task_id,
    fingerprint: task.fingerprint,
    trigger_summary: trigSummary,
    estimated_cost_usd: budget.round2(candidate.estimated_cost_usd),
    budget_status: {
      month: statusBefore.month,
      spent_before_usd: statusBefore.spent_usd,
      monthly_target_usd: statusBefore.monthly_target_usd,
      hard_cap_usd: statusBefore.hard_cap_usd,
      pct_of_cap: statusBefore.pct_of_cap,
      action: statusBefore.action
    },
    outputs: {
      findings_path: path.relative(ROOT, FINDINGS_PATH),
      content_draft_path: null,
      quality_report_path: null
    },
    outcome: "completed",
    error: null
  };
  delete candidate._model_selection_reason;

  const rSchema = readJSONSafe(RUN_SCHEMA);
  const rRes = validate(record, rSchema);
  if (!rRes.valid) {
    console.error("[runner] run record failed schema validation:");
    rRes.errors.forEach((e) => console.error("  · " + e.path + ": " + e.message));
    process.exit(2);
  }
  if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
  const recPath = path.join(RUNS_DIR, dateStr + "-" + run_id + ".json");
  fs.writeFileSync(recPath, JSON.stringify(record, null, 2) + "\n");

  // Mark the task completed (idempotency anchor).
  task.status = "completed";
  fs.writeFileSync(TASK_PATH, JSON.stringify(task, null, 2) + "\n");

  console.log("[runner] OK shadow findings written.");
  console.log("  findings  -> " + path.relative(ROOT, FINDINGS_PATH));
  console.log("  run record-> " + path.relative(ROOT, recPath));
  console.log("  ledger    -> " + path.relative(ROOT, LEDGER_PATH) + " (+$" + budget.round2(candidate.estimated_cost_usd) + ", model " + (candidate.model_used || "unknown") + ")");
  console.log("  task status -> completed");
  process.exit(0);
}

function main() {
  const argv = process.argv;
  if (argv.indexOf("--prep") !== -1) return cmdPrep();
  const ingestIdx = argv.indexOf("--ingest");
  if (ingestIdx !== -1) return cmdIngest(argv[ingestIdx + 1]);
  console.error("usage: research-runner.js --prep | --ingest <candidate-findings.json>");
  process.exit(1);
}

main();
