#!/usr/bin/env node
/* ========================================================================
   ProductSnap Studio — Pulse cadence + next-release table generator

   Produces data/pulse-cadence.json: one honest row per signal describing
     - how the number is sourced (automated vs human-curated vs pending)
     - how often it updates (cadence, in plain English)
     - the date of the latest observation we hold
     - an ESTIMATED next-refresh window (clearly labelled an estimate, never
       presented as an official release calendar we do not have)
     - whether the signal is independently source-verifiable

   WHY this exists (per the trust backbone):
     The page must never imply a curated signal is machine-verified, and must
     never imply we know an exact government release date we cannot guarantee.
     This table is the single, honest place those distinctions live, so the UI
     can render trust markers from data instead of hand-written claims.

   Sourcing labels (exactly three, no euphemisms):
     "automated"          fetched from a free public API (FRED/BLS), source-verifiable
     "human-curated"      hand-maintained editorial signal, NOT source-verifiable
     "pending-automation" intended to be automated; no free API yet (e.g. ISM)

   Reads:  data/signals_registry.json (cadence/status/source of record)
           data/pulse-content.json    (latest observation date actually held)
   Writes: data/pulse-cadence.json

   Dependency-free, deterministic, offline. Node built-ins only.
   Run: node scripts/generate-cadence-table.js
        node scripts/generate-cadence-table.js --check   (verify in sync, no write)
   ======================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "data", "signals_registry.json");
const CONTENT_REAL = path.join(ROOT, "data", "pulse-content.json");
const OUT_PATH = path.join(ROOT, "data", "pulse-cadence.json");

function load(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function log(msg) { console.log(`[pulse-cadence] ${msg}`); }

// --- Sourcing classification (honest, three buckets) --------------------
function classifySourcing(statusType) {
  if (statusType === "automated") {
    return { sourcing: "automated", source_verifiable: true,
      sourcing_label: "Automated — pulled from a public government API" };
  }
  if (statusType === "pending_automation") {
    return { sourcing: "pending-automation", source_verifiable: false,
      sourcing_label: "Pending automation — no free public API yet; tracked manually for now" };
  }
  // everything else (manual / curated / unknown) is human-curated
  return { sourcing: "human-curated", source_verifiable: false,
    sourcing_label: "Human-curated — maintained by editorial review, not machine-verified" };
}

// --- Plain-English cadence ----------------------------------------------
function plainCadence(cadenceKey) {
  const map = {
    daily: "Updates every market day",
    weekly: "Updates weekly",
    monthly: "Updates once a month",
    quarterly: "Updates once a quarter",
    "weekly-curated": "Reviewed weekly by editorial",
    "event-driven": "Updates only when something happens (no fixed schedule)"
  };
  return map[cadenceKey] || `Updates ${cadenceKey}`;
}

// --- Estimated next refresh ----------------------------------------------
// Deterministic estimate from the latest observation date + one cadence
// period. Explicitly an ESTIMATE: government release calendars are not free
// or guaranteed, so we never claim an exact official date. event-driven and
// curated signals return null (no schedule to estimate).
function estimateNextRefresh(cadenceKey, lastObservationDate) {
  if (!lastObservationDate) return null;
  const norm = /^\d{4}-\d{2}$/.test(lastObservationDate)
    ? `${lastObservationDate}-01` : lastObservationDate;
  const d = new Date(`${norm}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;

  // Roll the estimate forward by one cadence period at a time until it lands
  // in the future. A monthly series whose last observation is two months old
  // should estimate the NEXT upcoming release, not a date already in the past.
  const now = new Date();
  const advance = {
    daily: (dt) => dt.setUTCDate(dt.getUTCDate() + 1),
    weekly: (dt) => dt.setUTCDate(dt.getUTCDate() + 7),
    monthly: (dt) => dt.setUTCMonth(dt.getUTCMonth() + 1, 15),
    quarterly: (dt) => dt.setUTCMonth(dt.getUTCMonth() + 3, 15)
  };
  const windowText = {
    daily: "next market day",
    weekly: "about a week out",
    monthly: "around the middle of the month",
    quarterly: "next quarter"
  };
  const step = advance[cadenceKey];
  if (!step) return null; // weekly-curated, event-driven, unknown -> no estimate

  // Always advance at least once past the last observation, then keep going
  // until the estimate is in the future (cap iterations defensively).
  let guard = 0;
  do {
    step(d);
    guard += 1;
  } while (d.getTime() <= now.getTime() && guard < 120);

  return { date: iso(d), window: windowText[cadenceKey], basis: "estimate" };
}

function iso(d) { return d.toISOString().slice(0, 10); }

function cadenceKeyOf(regSignal) {
  const c = regSignal.cadence;
  if (c && typeof c === "object") return c.cadence || c.refresh_frequency || null;
  if (typeof c === "string") return c;
  return regSignal.refresh_frequency || null;
}

function sourceOfRecord(regSignal) {
  const ss = regSignal.source_series;
  const provider = ss && typeof ss === "object" ? ss.provider : null;
  const seriesId = ss && typeof ss === "object" ? ss.series_id : null;
  let url = null;
  if (provider === "FRED" && seriesId) url = `https://fred.stlouisfed.org/series/${seriesId}`;
  else if (provider === "BLS" && seriesId) url = `https://data.bls.gov/timeseries/${seriesId}`;
  return {
    provider: provider || "manual",
    series_id: seriesId || null,
    source_name: typeof regSignal.source === "string" ? regSignal.source : null,
    source_url: url
  };
}

function main() {
  const check = process.argv.includes("--check");
  const registry = load(REGISTRY_PATH);
  const content = load(CONTENT_REAL);
  const contentById = new Map((content.signals || []).map((s) => [s.id, s]));

  const rows = [];
  for (const reg of registry.signals || []) {
    const id = reg.signal_id || reg.id;
    const cls = classifySourcing(reg.status_type);
    const cadenceKey = cadenceKeyOf(reg);
    const c = contentById.get(id);
    const lastObservation = c ? (c.last_updated || (c.timestamps && c.timestamps.latest_source_data_date) || null) : null;

    const nextRefresh = cls.sourcing === "automated"
      ? estimateNextRefresh(cadenceKey, lastObservation)
      : null; // only estimate for machine-sourced series; never fake a curated schedule

    rows.push({
      id,
      name: reg.name || id,
      tier: reg.tier != null ? reg.tier : null,
      sourcing: cls.sourcing,
      sourcing_label: cls.sourcing_label,
      source_verifiable: cls.source_verifiable,
      cadence: cadenceKey,
      cadence_plain: plainCadence(cadenceKey),
      latest_observation_date: lastObservation,
      next_refresh_estimate: nextRefresh, // {date, window, basis:"estimate"} | null
      in_published_content: Boolean(c),
      source_of_record: sourceOfRecord(reg)
    });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    signal_count: rows.length,
    automated: rows.filter((r) => r.sourcing === "automated").length,
    human_curated: rows.filter((r) => r.sourcing === "human-curated").length,
    pending_automation: rows.filter((r) => r.sourcing === "pending-automation").length,
    note: "next_refresh_estimate is a deterministic estimate from cadence + last observation, NOT an official release calendar. Curated/event-driven signals carry no estimate."
  };

  const doc = { schema_version: "1.0.0", summary, signals: rows };
  const serialized = JSON.stringify(doc, null, 2) + "\n";

  if (check) {
    let existing = null;
    try { existing = fs.readFileSync(OUT_PATH, "utf8"); } catch (e) { existing = null; }
    // Compare everything except generated_at (which always changes).
    const stripTs = (s) => s.replace(/"generated_at":\s*"[^"]*"/, '"generated_at":"<ts>"');
    if (existing != null && stripTs(existing) === stripTs(serialized)) {
      log(`--check: data/pulse-cadence.json is in sync (${rows.length} signals).`);
      return;
    }
    log("--check: data/pulse-cadence.json is OUT OF SYNC with registry/content. Run without --check to regenerate.");
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(OUT_PATH, serialized);
  log(`Wrote ${path.relative(ROOT, OUT_PATH)} — ${summary.automated} automated, ${summary.human_curated} human-curated, ${summary.pending_automation} pending-automation (${rows.length} total).`);
}

main();
