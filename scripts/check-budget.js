#!/usr/bin/env node
/* =============================================================================
   check-budget.js — Pulse automation budget governor (deterministic, dep-free)
   -----------------------------------------------------------------------------
   Reads the spend ledger and the budget block from automation-config.json and
   computes what the AI layer is allowed to do THIS calendar month:

       proceed   — under the downgrade threshold; use the role's default model
       downgrade — at/over downgrade_at_pct of the hard cap; use the cheapest
                   acceptable candidate for the role
       stop      — at/over stop_drafting_at_pct of the hard cap; do NOT draft
                   new editorial interpretation (factual data refresh is a
                   SEPARATE pipeline and is never affected by this)

   This script is pure arithmetic over JSON. It calls no AI and has no npm deps.
   It is the single source of truth the Computer-side runner consults before
   spending anything. In Phase 1 the runner treats it as authoritative for
   model routing but the deterministic GitHub data pipeline does not depend on
   it at all.

   Usage:
     node scripts/check-budget.js                 # human summary
     node scripts/check-budget.js --json          # machine-readable status
     node scripts/check-budget.js --add <usd> --role research --model gpt_5_5
                                                  # append a ledger entry, then report
                                                  # (used by the runner AFTER a successful run)

   Exit code is always 0; the governor reports, it never breaks a pipeline.
   ===========================================================================*/
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "automation", "automation-config.json");
const LEDGER_PATH = path.join(ROOT, "automation", "spend-ledger.json");

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

function currentMonth(d) {
  const dt = d || new Date();
  return dt.toISOString().slice(0, 7); // YYYY-MM (UTC)
}

function sumMonth(ledger, month) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  return entries
    .filter((e) => e && typeof e.month === "string" && e.month === month)
    .reduce((acc, e) => acc + (Number(e.estimated_cost_usd) || 0), 0);
}

function computeStatus(config, ledger, opts) {
  const month = currentMonth(opts.now);
  const budget = (config && config.budget) || {};
  const target = Number(budget.monthly_target_usd);
  const cap = Number(budget.hard_cap_usd);
  const downgradePct = Number(budget.downgrade_at_pct);
  const stopPct = Number(budget.stop_drafting_at_pct != null ? budget.stop_drafting_at_pct : 100);

  const spent = sumMonth(ledger, month);
  const pctOfCap = cap > 0 ? (spent / cap) * 100 : 0;

  let action = "proceed";
  if (pctOfCap >= stopPct) action = "stop";
  else if (pctOfCap >= downgradePct) action = "downgrade";

  return {
    month,
    spent_usd: round2(spent),
    monthly_target_usd: target,
    hard_cap_usd: cap,
    downgrade_at_pct: downgradePct,
    stop_drafting_at_pct: stopPct,
    pct_of_cap: round2(pctOfCap),
    pct_of_target: target > 0 ? round2((spent / target) * 100) : null,
    action,
    note:
      action === "stop"
        ? "Hard cap reached. Do NOT draft new editorial interpretation. Factual data refresh continues unaffected."
        : action === "downgrade"
        ? "At/over downgrade threshold. Route each role to its cheapest acceptable model."
        : "Under thresholds. Use each role's default model."
  };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function appendEntry(ledger, entry) {
  if (!Array.isArray(ledger.entries)) ledger.entries = [];
  ledger.entries.push(entry);
  // refresh months rollup cache
  const months = {};
  ledger.entries.forEach((e) => {
    if (!e || typeof e.month !== "string") return;
    months[e.month] = round2((months[e.month] || 0) + (Number(e.estimated_cost_usd) || 0));
  });
  ledger.months = months;
  return ledger;
}

function parseArgs(argv) {
  const a = { json: false, add: null, role: null, model: null, runId: null, taskId: null, fingerprint: null };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") a.json = true;
    else if (t === "--add") a.add = Number(argv[++i]);
    else if (t === "--role") a.role = argv[++i];
    else if (t === "--model") a.model = argv[++i];
    else if (t === "--run-id") a.runId = argv[++i];
    else if (t === "--task-id") a.taskId = argv[++i];
    else if (t === "--fingerprint") a.fingerprint = argv[++i];
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv);
  let config, ledger;
  try {
    config = readJSON(CONFIG_PATH);
    ledger = readJSON(LEDGER_PATH);
  } catch (err) {
    console.error("[check-budget] cannot read config/ledger:", err.message);
    process.exit(0); // governor never breaks the pipeline
  }

  // Optional: append a spend entry (called by runner AFTER a successful AI run).
  if (args.add != null && !Number.isNaN(args.add)) {
    const now = new Date();
    const entry = {
      ts: now.toISOString(),
      month: currentMonth(now),
      role: args.role || "research",
      model: args.model || "unknown",
      estimated_cost_usd: round2(args.add),
      run_id: args.runId || null,
      task_id: args.taskId || null,
      fingerprint: args.fingerprint || null
    };
    appendEntry(ledger, entry);
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
  }

  const status = computeStatus(config, ledger, { now: new Date() });

  if (args.json) {
    process.stdout.write(JSON.stringify(status) + "\n");
  } else {
    console.log("[check-budget] month=" + status.month +
      " spent=$" + status.spent_usd + " / target $" + status.monthly_target_usd +
      " / cap $" + status.hard_cap_usd +
      " (" + status.pct_of_cap + "% of cap) -> ACTION=" + status.action);
    console.log("  " + status.note);
  }
  process.exit(0);
}

// Export pure helpers for the runner / tests.
module.exports = { computeStatus, sumMonth, appendEntry, currentMonth, round2 };

if (require.main === module) main();
