#!/usr/bin/env node
/* =============================================================================
   draft-editorial.js  —  Phase 1: TRIGGER DECISION, LOG-ONLY (no LLM, no write)
   -----------------------------------------------------------------------------
   This is the first, deliberately inert step of the event-driven editorial
   automation. It answers ONE question on every pipeline run:

        "Has anything changed enough that the editorial read should be
         re-drafted — or is the current read still valid?"

   It does NOT call any language model. It does NOT write content. It does NOT
   gate the build. It only computes a KEEP-vs-DRAFT decision and records a
   `generation_snapshot` to data/pulse-editorial-decision.json so we can watch
   the trigger behave over real refreshes BEFORE we ever let AI write a word
   (that is Phase 2/3, guarded by separate kill-switches).

   DECISION = DRAFT when ANY trigger fires:
     1. narrative_review_required / review_required on the Weekly Connection,
        or a connected signal is in alignment "mismatch"  (existing machinery)
     2. the editorial read is STALE past its freshness window               (policy)
     3. a tracked signal made a MATERIAL data move                          (new)
   Otherwise DECISION = KEEP (the words are still earning their place).

   Reads only. Exit code is always 0 unless inputs are unreadable — this step
   must never break a green pipeline while it is in log-only mode.
   ===========================================================================*/

"use strict";

const fs = require("fs");
const path = require("path");
const trust = require("./lib/pulse-trust");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_PATH = path.join(ROOT, "data", "pulse-content.json");
const REGISTRY_PATH = path.join(ROOT, "data", "signals_registry.json");
const DECISION_PATH = path.join(ROOT, "data", "pulse-editorial-decision.json");

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function registryById(registry) {
  const map = {};
  const list = (registry && registry.signals) || [];
  list.forEach((e) => { if (e && e.signal_id) map[e.signal_id] = e; });
  return map;
}

// Most-recent vs prior value from a signal's own data_points time series.
// This is the value pair the material-move check compares. Returns null when
// there isn't a clean consecutive pair.
function lastTwoPoints(signal) {
  const pts = Array.isArray(signal.data_points) ? signal.data_points.slice() : [];
  if (pts.length < 2) return null;
  // data_points are chronological; take the final two.
  const prev = pts[pts.length - 2];
  const curr = pts[pts.length - 1];
  if (!prev || !curr) return null;
  return { prevValue: prev.value, newValue: curr.value, prevDate: prev.date, newDate: curr.date };
}

function main() {
  const now = new Date();
  let content, registry;
  try {
    content = readJSON(CONTENT_PATH);
    registry = readJSON(REGISTRY_PATH);
  } catch (err) {
    console.error("[draft-editorial] cannot read inputs:", err.message);
    process.exit(1);
  }

  const signals = Array.isArray(content.signals) ? content.signals : [];
  const wc = content.weekly_connection || {};
  const regMap = registryById(registry);
  const policy = (registry.editorial_freshness_policy) || {};
  const wcExpiry = policy.weekly_connection_expires_after_days != null
    ? policy.weekly_connection_expires_after_days : 7;

  const triggers = [];

  // ---- Trigger 1: existing review machinery (alignment / explicit flags) ----
  const needsReview = trust.weeklyConnectionNeedsReview(wc, signals);
  if (needsReview) triggers.push({ type: "narrative_review_required", detail: "Weekly Connection flagged or a connected signal is in alignment mismatch" });

  // ---- Trigger 2: editorial freshness window ----
  const reviewed = wc.last_editorial_reviewed || wc.date || null;
  const fresh = trust.editorialFreshness(reviewed, wcExpiry, now);
  if (fresh.editorial_status === "stale") {
    triggers.push({ type: "editorial_stale", detail: "editorial read past its " + wcExpiry + "-day window (age " + fresh.age_days + "d)" });
  }

  // ---- Trigger 3: material data move on any tracked signal ----
  const materialMoves = [];
  signals.forEach((s) => {
    const pair = lastTwoPoints(s);
    if (!pair) return;
    const reg = regMap[s.id];
    const move = trust.materialDataMove(pair.prevValue, pair.newValue, reg);
    if (move.material) {
      materialMoves.push({ id: s.id, delta: move.delta, reasons: move.reasons, from: pair.prevValue, to: pair.newValue });
    }
  });
  if (materialMoves.length) {
    triggers.push({ type: "material_data_move", detail: materialMoves.length + " signal(s) moved materially", signals: materialMoves });
  }

  const decision = triggers.length ? "DRAFT" : "KEEP";

  const snapshot = {
    generated_at: now.toISOString(),
    mode: "log_only",            // Phase 1: never writes content, never calls an LLM
    llm_invoked: false,
    decision: decision,          // KEEP = current read still valid; DRAFT = re-draft warranted
    triggers: triggers,
    editorial_freshness: fresh,
    weekly_connection_reviewed: reviewed,
    note: "Phase 1 log-only. No content was generated or published. This snapshot records what the event-driven trigger WOULD do once AI drafting is enabled (Phase 2/3)."
  };

  try {
    fs.writeFileSync(DECISION_PATH, JSON.stringify(snapshot, null, 2) + "\n");
  } catch (err) {
    console.error("[draft-editorial] could not write decision snapshot:", err.message);
    // Non-fatal in log-only mode.
  }

  console.log("[draft-editorial] decision=" + decision +
    " triggers=" + triggers.map((t) => t.type).join(",") || "(none)");
  console.log("[draft-editorial] editorial_status=" + fresh.editorial_status +
    " age_days=" + fresh.age_days);
  if (materialMoves.length) {
    materialMoves.forEach((m) =>
      console.log("  · material move: " + m.id + " " + m.from + "->" + m.to + " [" + m.reasons.join(", ") + "]"));
  }
  console.log("[draft-editorial] snapshot -> " + path.relative(ROOT, DECISION_PATH));

  // Always succeed in log-only mode; this step must never break the pipeline.
  process.exit(0);
}

main();
