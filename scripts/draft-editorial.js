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
const { spawnSync } = require("child_process");
const trust = require("./lib/pulse-trust");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_PATH = path.join(ROOT, "data", "pulse-content.json");
const REGISTRY_PATH = path.join(ROOT, "data", "signals_registry.json");
const DECISION_PATH = path.join(ROOT, "data", "pulse-editorial-decision.json");
const CONFIG_PATH = path.join(ROOT, "automation", "automation-config.json");
const EMIT_TASK_SCRIPT = path.join(__dirname, "emit-editorial-task.js");

// Read the automation phase WITHOUT introducing any dependency. Missing/unreadable
// config is treated as phase 0 (pre-automation behavior). This function must never throw.
function readPhase() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const enabled = !(cfg.kill_switch && cfg.kill_switch.editorial_automation_enabled === false);
    return { phase: Number(cfg.editorial_automation_phase) || 0, enabled };
  } catch (e) {
    return { phase: 0, enabled: true };
  }
}

// Phase >= 1: hand the decision off to the typed-task emitter as a SEPARATE
// child process. draft-editorial.js stays dependency-free and the emitter
// cannot break this pipeline — any failure is logged and swallowed. At phase 0
// this is never called, so behavior is byte-for-byte the pre-automation path.
function maybeEmitEditorialTask() {
  const { phase, enabled } = readPhase();
  if (phase < 1 || !enabled) {
    console.log("[draft-editorial] editorial_automation_phase=" + phase +
      " enabled=" + enabled + " -> handoff inert (log-only).");
    return;
  }
  try {
    const res = spawnSync(process.execPath, [EMIT_TASK_SCRIPT], {
      cwd: ROOT, encoding: "utf8", timeout: 20000
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    if (res.error) {
      console.error("[draft-editorial] emit-task spawn error (non-fatal): " + res.error.message);
    }
  } catch (err) {
    console.error("[draft-editorial] emit-task failed (non-fatal): " + err.message);
  }
}

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

// Read the previous decision snapshot's per-signal triggering-observation map.
// Returns { [signal_id]: "YYYY-MM(-DD)" } recording, for each signal that has
// EVER fired a material-move trigger, the observation date that triggered it.
// This is how we make the trigger freshness-aware: a material move only counts
// once per NEW observation. A month-old move must not re-fire a DRAFT every day
// just because it is still the most recent two points in the series.
function readPriorTriggeringObservations() {
  try {
    const prior = readJSON(DECISION_PATH);
    if (prior && prior.triggering_observations && typeof prior.triggering_observations === "object") {
      return { map: prior.triggering_observations, hadMap: true };
    }
    // A prior snapshot exists but predates the freshness fix (no map). Anything
    // already material in today's data has effectively been "seen" by the old
    // every-run trigger, so we seed it as already-triggered on this first run
    // to avoid one redundant re-fire of month-old news. Genuinely new
    // observations arriving later will still fire because their date will be
    // strictly newer than the seeded date.
    return { map: {}, hadMap: false };
  } catch (err) {
    // No prior snapshot at all (true first run) -> empty map, treat as fresh.
    return { map: {}, hadMap: false };
  }
}

// Is observationDate strictly newer than the last date that triggered a move
// for this signal? Dates are ISO-like ("YYYY-MM" or "YYYY-MM-DD"); lexical
// comparison on normalized strings is correct for chronological ordering.
function isNewerObservation(observationDate, lastTriggeredDate) {
  if (!observationDate) return false;
  if (!lastTriggeredDate) return true; // never triggered before -> new
  const norm = (d) => (/^\d{4}-\d{2}$/.test(d) ? d + "-01" : d);
  return norm(observationDate) > norm(lastTriggeredDate);
}

// Read the previous decision snapshot's per-signal editorial-staleness firing
// map. Returns { [signal_id]: "YYYY-MM-DD" } recording, for each signal whose
// PER-SIGNAL editorial read last fired a staleness DRAFT, the
// last_editorial_reviewed date that fired it. This makes the per-signal
// staleness trigger freshness-aware: a stale read fires a DRAFT ONCE and then
// stays quiet until the read is actually refreshed (its last_editorial_reviewed
// changes). Without this, an 80-day-old summary would re-fire a near-identical
// DRAFT every single run forever. Same shape/spirit as
// readPriorTriggeringObservations() for material moves.
function readPriorEditorialReadFirings() {
  try {
    const prior = readJSON(DECISION_PATH);
    if (prior && prior.triggering_editorial_reads && typeof prior.triggering_editorial_reads === "object") {
      return { map: prior.triggering_editorial_reads, hadMap: true };
    }
    // A prior snapshot exists but predates this fix (no map). Anything already
    // stale today has effectively been visible to the user under the old
    // behavior, so seed it as already-fired on this first run to avoid one
    // redundant re-fire. A genuinely refreshed read later (newer
    // last_editorial_reviewed) still fires because its date will be strictly
    // newer than the seeded date.
    return { map: {}, hadMap: false };
  } catch (err) {
    return { map: {}, hadMap: false };
  }
}

// Pull the per-signal editorial read date + status for a content signal. The
// daily refresh already computes signal.editorial_freshness against the
// per-signal policy window; we PREFER that authoritative value and only
// recompute as a fallback when it is absent. Returns null when there is no
// editorial read date to judge.
function perSignalEditorial(signal, perSignalExpiry, now) {
  const ef = (signal && signal.editorial_freshness) || {};
  const reviewed = ef.last_editorial_reviewed || null;
  if (ef.editorial_status) {
    return { reviewed, status: ef.editorial_status, age_days: (ef.age_days != null ? ef.age_days : null) };
  }
  if (!reviewed) return null;
  const f = trust.editorialFreshness(reviewed, perSignalExpiry, now);
  return { reviewed, status: f.editorial_status, age_days: f.age_days };
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
  const perSignalExpiry = policy.per_signal_thesis_expires_after_days != null
    ? policy.per_signal_thesis_expires_after_days : 35;

  const triggers = [];

  // ---- Trigger 1: existing review machinery (alignment / explicit flags) ----
  const needsReview = trust.weeklyConnectionNeedsReview(wc, signals);
  if (needsReview) triggers.push({ type: "narrative_review_required", detail: "Weekly Connection flagged or a connected signal is in alignment mismatch" });

  // ---- Trigger 2: editorial freshness (TWO windows) ----
  // (a) The Weekly Connection's narrative read vs the 7-day WC window (existing).
  // (b) Each SIGNAL's own editorial read vs the 35-day per-signal thesis window
  //     (new). Previously the per-signal status was COMPUTED and stored on each
  //     signal but never fired a DRAFT, so an 80-day-old summary (e.g.
  //     consumer-confidence) could sit indefinitely with no refresh path unless
  //     it happened to be one of the Weekly Connection's connected_signals. This
  //     closes that gap. Per-signal staleness is freshness-aware: a stale read
  //     fires ONCE and stays quiet until the read is actually refreshed (its
  //     last_editorial_reviewed changes), so we don't re-draft the same old
  //     summary every run.
  const reviewed = wc.last_editorial_reviewed || wc.date || null;
  const fresh = trust.editorialFreshness(reviewed, wcExpiry, now);
  const wcStale = fresh.editorial_status === "stale";

  // (b) per-signal stale reads, freshness-aware.
  const priorReads = readPriorEditorialReadFirings();
  const priorReadFired = priorReads.map;
  const triggeringEditorialReads = Object.assign({}, priorReadFired); // carry forward
  const staleSignals = [];          // fired this run -> in scope for the DRAFT
  const staleReadsSuppressed = [];  // stale but the same read already fired before
  signals.forEach((s) => {
    const pe = perSignalEditorial(s, perSignalExpiry, now);
    if (!pe || pe.status !== "stale") return;
    const readDate = pe.reviewed || null;
    let lastFiredDate = priorReadFired[s.id] || null;
    // Seed-on-migration: prior snapshot predates this fix -> treat the current
    // stale read as already-fired so it doesn't re-fire once more on rollout.
    if (!priorReads.hadMap && lastFiredDate == null) {
      lastFiredDate = readDate; // seed -> suppress this run
    }
    // "Refreshed" means a strictly newer last_editorial_reviewed than what last
    // fired. We reuse isNewerObservation (same normalized date comparison).
    if (isNewerObservation(readDate, lastFiredDate)) {
      staleSignals.push({ id: s.id, last_editorial_reviewed: readDate, age_days: pe.age_days });
      triggeringEditorialReads[s.id] = readDate;
    } else {
      triggeringEditorialReads[s.id] = lastFiredDate || readDate;
      staleReadsSuppressed.push({ id: s.id, last_editorial_reviewed: readDate, last_fired: lastFiredDate, age_days: pe.age_days });
    }
  });

  if (wcStale || staleSignals.length) {
    const reasons = [];
    if (wcStale) reasons.push("Weekly Connection read past its " + wcExpiry + "-day window (age " + fresh.age_days + "d)");
    if (staleSignals.length) reasons.push(staleSignals.length + " signal read(s) past the " + perSignalExpiry + "-day window: " + staleSignals.map((x) => x.id + "(" + (x.age_days != null ? x.age_days + "d" : "stale") + ")").join(", "));
    // The decision-snapshot trigger carries the rich stale_signals[] so
    // emit-editorial-task can scope exactly those signals. The EMITTED task's
    // trigger object is schema-trimmed to {type, detail} by emit-task (its
    // schema forbids extra trigger fields) — same pattern as material_data_move,
    // whose rich `signals` live on the decision and are trimmed for the task.
    const t = { type: "editorial_stale", detail: reasons.join("; ") };
    if (staleSignals.length) t.stale_signals = staleSignals;
    triggers.push(t);
  }

  // ---- Trigger 3: material data move on any tracked signal (freshness-aware) ----
  // A material move only fires a DRAFT when the move's latest observation is
  // NEWER than the observation that last triggered a move for that signal.
  // Otherwise the same stale move (e.g. mfg-activity's month-old 26.7 -> -0.4)
  // re-triggers a DRAFT on every daily run forever. We carry forward the prior
  // triggering dates so each new observation can fire at most once.
  const priorState = readPriorTriggeringObservations();
  const priorTriggered = priorState.map;
  const triggeringObservations = Object.assign({}, priorTriggered); // carry forward
  const materialMoves = [];
  const staleMovesSuppressed = [];
  signals.forEach((s) => {
    const pair = lastTwoPoints(s);
    if (!pair) return;
    const reg = regMap[s.id];
    const move = trust.materialDataMove(pair.prevValue, pair.newValue, reg);
    if (!move.material) return;

    // Seed-on-migration: if the prior snapshot predates the freshness fix
    // (no map), treat a currently-material observation as already-triggered so
    // pre-existing month-old moves don't re-fire once more. From then on the
    // carried-forward map governs.
    let lastTriggeredDate = priorTriggered[s.id] || null;
    if (!priorState.hadMap && lastTriggeredDate == null) {
      lastTriggeredDate = pair.newDate; // seed -> suppress this run
    }
    if (isNewerObservation(pair.newDate, lastTriggeredDate)) {
      // Genuinely new observation moved materially -> fire, and record the date
      // so the same observation cannot re-fire on subsequent runs.
      materialMoves.push({ id: s.id, delta: move.delta, reasons: move.reasons, from: pair.prevValue, to: pair.newValue, observation_date: pair.newDate });
      triggeringObservations[s.id] = pair.newDate;
    } else {
      // Material in shape, but it is the same (or older) observation that already
      // triggered. Suppress it so we don't re-draft month-old news every day.
      // Record the suppressed observation date so the carried-forward map stays
      // accurate (covers the seed-on-migration case, where there was no prior
      // entry but we are treating this observation as already-seen).
      triggeringObservations[s.id] = lastTriggeredDate || pair.newDate;
      staleMovesSuppressed.push({ id: s.id, observation_date: pair.newDate, last_triggered: lastTriggeredDate, from: pair.prevValue, to: pair.newValue });
    }
  });
  if (materialMoves.length) {
    triggers.push({ type: "material_data_move", detail: materialMoves.length + " signal(s) moved materially on a NEW observation", signals: materialMoves });
  }

  const decision = triggers.length ? "DRAFT" : "KEEP";

  const snapshot = {
    generated_at: now.toISOString(),
    mode: "log_only",            // Phase 1: never writes content, never calls an LLM
    llm_invoked: false,
    decision: decision,          // KEEP = current read still valid; DRAFT = re-draft warranted
    triggers: triggers,
    // Per-signal map of the observation date that last fired a material-move
    // trigger. Carried forward run-to-run so a given observation fires at most
    // once. This is the trigger-freshness state.
    triggering_observations: triggeringObservations,
    // Material moves seen this run that were SUPPRESSED because their observation
    // already triggered previously (kept for auditability; not a trigger).
    suppressed_stale_moves: staleMovesSuppressed,
    // Per-signal map of the last_editorial_reviewed date that last fired a
    // PER-SIGNAL editorial-staleness trigger. Carried forward run-to-run so a
    // stale read fires at most once until it is actually refreshed. This is the
    // per-signal staleness freshness-state (mirrors triggering_observations).
    triggering_editorial_reads: triggeringEditorialReads,
    // Per-signal stale reads seen this run that were SUPPRESSED because the same
    // read already fired previously (kept for auditability; not a trigger).
    suppressed_stale_reads: staleReadsSuppressed,
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
      console.log("  · material move (NEW @ " + m.observation_date + "): " + m.id + " " + m.from + "->" + m.to + " [" + m.reasons.join(", ") + "]"));
  }
  if (staleMovesSuppressed.length) {
    staleMovesSuppressed.forEach((m) =>
      console.log("  · suppressed stale move: " + m.id + " " + m.from + "->" + m.to + " (obs " + m.observation_date + " already triggered " + (m.last_triggered || "n/a") + ")"));
  }
  if (staleSignals.length) {
    staleSignals.forEach((x) =>
      console.log("  · stale editorial read (NEW): " + x.id + " reviewed " + (x.last_editorial_reviewed || "n/a") + " (age " + (x.age_days != null ? x.age_days + "d" : "?") + ", past " + perSignalExpiry + "d window)"));
  }
  if (staleReadsSuppressed.length) {
    staleReadsSuppressed.forEach((x) =>
      console.log("  · suppressed stale read: " + x.id + " reviewed " + (x.last_editorial_reviewed || "n/a") + " (already fired " + (x.last_fired || "n/a") + ")"));
  }
  console.log("[draft-editorial] snapshot -> " + path.relative(ROOT, DECISION_PATH));

  // Phase >= 1 ONLY: emit the typed editorial handoff task for the (separate,
  // out-of-pipeline) AI research agent to pick up. Shadow mode means this still
  // publishes nothing — it just writes a reviewable task file. Non-breaking.
  maybeEmitEditorialTask();

  // Always succeed in log-only mode; this step must never break the pipeline.
  process.exit(0);
}

main();
