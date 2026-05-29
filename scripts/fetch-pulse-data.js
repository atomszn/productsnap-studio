#!/usr/bin/env node
/* ========================================================================
   ProductSnap Studio — Pulse Pass B live data refresh

   Purpose:
   - Refresh numeric/data-only fields in data/pulse-content.json.
   - Preserve editorial content byte-for-byte in memory-equivalent JSON.
   - Fail safely: each signal is isolated; failed fetches keep last-known-good.

   Local use:
     node scripts/fetch-pulse-data.js --dry-run --output /tmp/pulse-content.json

   GitHub Actions use:
     node scripts/fetch-pulse-data.js

   Required secrets in GitHub Actions:
     FRED_API_KEY, BLS_API_KEY, BEA_API_KEY, CENSUS_API_KEY
   ======================================================================== */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA_PATH = path.join(ROOT, "data", "pulse-content.json");

const AUTO_SIGNAL_IDS = [
  "cpi-headline",
  "ppi",
  "pce",
  "fed-net-liquidity",
  "10y-treasury",
  "retail-sales",
  "consumer-confidence",
  "nonfarm-payrolls"
];

const HAND_CURATED_SIGNAL_IDS = [
  "series-a-counts",
  "ai-model-releases",
  "ai-api-pricing",
  "compute-cost",
  "open-source-ai",
  "emerging-apps",
  "tech-hiring",
  "ai-regulation"
];

const MUTABLE_DATA_FIELDS = new Set([
  "current_value",
  "data_points",
  "compared_to",
  "percentile",
  "last_updated"
]);

// Consumer-confidence moves from proprietary Conference Board CCI to the
// free University of Michigan Consumer Sentiment series via FRED. These
// source/label fields are intentionally allowed only for that substitution.
const CONSUMER_CONFIDENCE_SOURCE_FIELDS = new Set([
  "current_unit",
  "source_note",
  "sources",
  "tier",
  "tier_label"
]);

const SIGNAL_CONFIG = {
  "cpi-headline": {
    provider: "bls",
    seriesId: "CUUR0000SA0",
    companionSeriesIds: ["CUUR0000SA0L1E"],
    transform: "index_yoy",
    valueFormat: "percent",
    compareMode: "points",
    sourceNote: "BLS CPI · monthly release"
  },
  "ppi": {
    provider: "bls",
    seriesId: "WPSFD4",
    transform: "index_yoy",
    valueFormat: "percent",
    compareMode: "points",
    sourceNote: "BLS PPI Final Demand · monthly release"
  },
  "nonfarm-payrolls": {
    provider: "bls",
    seriesId: "CES0000000001",
    transform: "monthly_change",
    valueFormat: "jobs_k",
    compareMode: "percent",
    sourceNote: "BLS Employment Situation · monthly release"
  },
  "pce": {
    provider: "bea",
    // The script discovers and validates the line description before using it.
    // Expected concept: PCE price index excluding food and energy / core PCE.
    tableCandidates: ["T20804", "T20304"],
    lineDescriptionNeedles: ["excluding food and energy", "less food and energy"],
    transform: "index_yoy",
    valueFormat: "percent",
    compareMode: "points",
    sourceNote: "BEA core PCE price index · monthly release"
  },
  "fed-net-liquidity": {
    provider: "fred",
    seriesId: "WALCL",
    transform: "level_monthly_last",
    valueFormat: "trillions",
    compareMode: "percent",
    sourceNote: "FRED WALCL · weekly"
  },
  "10y-treasury": {
    provider: "fred",
    seriesId: "DGS10",
    transform: "level_monthly_last",
    valueFormat: "percent",
    compareMode: "points",
    sourceNote: "FRED DGS10 · daily"
  },
  "retail-sales": {
    provider: "census",
    // U.S. total retail and food services, adjusted sales. The endpoint is
    // intentionally isolated so failure keeps the last-known-good value.
    dataset: "timeseries/eits/marts",
    params: {
      get: "cell_value,time_slot_id",
      category_code: "44X72",
      data_type_code: "SM",
      seasonally_adj: "yes"
    },
    transform: "index_yoy",
    valueFormat: "percent",
    compareMode: "points",
    sourceNote: "Census Monthly Retail Trade · monthly release"
  },
  "consumer-confidence": {
    provider: "fred",
    seriesId: "UMCSENT",
    transform: "level_monthly_last",
    valueFormat: "number_1",
    compareMode: "percent",
    sourceNote: "University of Michigan Consumer Sentiment · via FRED",
    sourceOverride: {
      current_unit: "University of Michigan index",
      source_note: "University of Michigan Consumer Sentiment · via FRED",
      tier: 1,
      tier_label: "primary",
      sources: [
        {
          name: "University of Michigan Consumer Sentiment (via FRED)",
          url: "https://fred.stlouisfed.org/series/UMCSENT",
          tier: 1
        }
      ]
    }
  }
};

const PRE_2020_BASELINES = {
  "cpi-headline": { date: "2020-01" },
  "ppi": { date: "2020-01" },
  "nonfarm-payrolls": { date: "2020-01" },
  "pce": { date: "2020-01" },
  "fed-net-liquidity": { date: "2020-01" },
  "10y-treasury": { date: "2020-01" },
  "retail-sales": { date: "2020-01" },
  "consumer-confidence": { date: "2020-01" }
};

function parseArgs(argv) {
  const args = {
    input: DEFAULT_DATA_PATH,
    output: null,
    dryRun: process.env.PULSE_DRY_RUN === "1",
    noWrite: false,
    verbose: false,
    simulateFailures: new Set()
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--input") args.input = path.resolve(argv[++i]);
    else if (a === "--output") args.output = path.resolve(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-write") args.noWrite = true;
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--simulate-failure") args.simulateFailures.add(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }

  if (process.env.PULSE_SIMULATE_FAILURE) {
    process.env.PULSE_SIMULATE_FAILURE
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => args.simulateFailures.add(s));
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = args.input;
  const outputPath = args.output || inputPath;

  const originalText = fs.readFileSync(inputPath, "utf8");
  const original = JSON.parse(originalText);
  const next = JSON.parse(originalText);

  assertExpectedSignals(next);

  let successCount = 0;
  const failures = [];

  for (const id of AUTO_SIGNAL_IDS) {
    const config = SIGNAL_CONFIG[id];
    const signal = next.signals.find((s) => s.id === id);

    try {
      if (args.simulateFailures.has(id) || args.simulateFailures.has(config.provider)) {
        throw new Error(`Simulated failure for ${id}`);
      }

      const update = args.dryRun
        ? buildDryRunUpdate(signal, config)
        : await fetchSignalUpdate(id, config);

      validateUpdate(id, update);
      applyAllowedUpdate(signal, update, id);
      successCount += 1;
      log(`✓ ${id}: refreshed ${update.current_value} (${update.last_updated})`);
    } catch (err) {
      failures.push({ id, error: err.message });
      log(`× ${id}: ${err.message}; kept last-known-good data`);
    }
  }

  assertEditorialPreserved(original, next);

  if (successCount === 0) {
    log("No signals refreshed successfully. Leaving JSON untouched.");
    process.exitCode = failures.length ? 1 : 0;
    return;
  }

  const nextText = JSON.stringify(next, null, 2) + "\n";
  const changed = nextText !== originalText;

  if (!changed) {
    log(`No JSON changes after ${successCount} successful refresh(es).`);
    return;
  }

  if (args.noWrite || (args.dryRun && !args.output)) {
    log(`Dry/no-write mode: ${successCount} successful refresh(es), JSON not written.`);
    return;
  }

  fs.writeFileSync(outputPath, nextText);
  log(`Wrote ${outputPath} with ${successCount} successful refresh(es).`);

  if (failures.length) {
    log(`Completed with ${failures.length} failure(s): ${failures.map((f) => f.id).join(", ")}`);
  }
}

async function fetchSignalUpdate(id, config) {
  if (config.provider === "fred") return fetchFredUpdate(id, config);
  if (config.provider === "bls") return fetchBlsUpdate(id, config);
  if (config.provider === "bea") return fetchBeaUpdate(id, config);
  if (config.provider === "census") return fetchCensusUpdate(id, config);
  throw new Error(`Unsupported provider: ${config.provider}`);
}

function buildDryRunUpdate(signal, config) {
  const update = {
    current_value: signal.current_value,
    data_points: signal.data_points,
    compared_to: signal.compared_to,
    percentile: signal.percentile,
    last_updated: signal.last_updated
  };
  if (config.sourceOverride) Object.assign(update, config.sourceOverride);
  return update;
}

async function fetchFredUpdate(id, config) {
  const key = requireEnv("FRED_API_KEY");
  const observations = await getFredObservations(config.seriesId, key, yearsAgoDate(11));
  const prepared = prepareSeries(observations, config.transform);
  return buildUpdateFromSeries(id, config, prepared);
}

async function fetchBlsUpdate(id, config) {
  const key = requireEnv("BLS_API_KEY");
  const seriesIds = [config.seriesId].concat(config.companionSeriesIds || []);
  const seriesMap = await getBlsSeries(seriesIds, key, new Date().getFullYear() - 11, new Date().getFullYear());
  const observations = seriesMap[config.seriesId];
  if (!observations || observations.length < 13) throw new Error(`BLS series ${config.seriesId} returned too few observations`);
  const prepared = prepareSeries(observations, config.transform);
  return buildUpdateFromSeries(id, config, prepared);
}

async function fetchBeaUpdate(id, config) {
  const key = requireEnv("BEA_API_KEY");
  const line = await discoverBeaCorePceLine(key, config);
  const observations = await getBeaNipaSeries(key, line.tableName, line.lineNumber);
  const prepared = prepareSeries(observations, config.transform);
  return buildUpdateFromSeries(id, config, prepared);
}

async function fetchCensusUpdate(id, config) {
  const key = requireEnv("CENSUS_API_KEY");
  const observations = await getCensusMartsSeries(key, config);
  const prepared = prepareSeries(observations, config.transform);
  return buildUpdateFromSeries(id, config, prepared);
}

async function getFredObservations(seriesId, apiKey, observationStart) {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", observationStart);

  const json = await fetchJson(url);
  const rows = json.observations || [];
  return rows
    .filter((r) => r.value != null && r.value !== ".")
    .map((r) => ({ date: r.date.slice(0, 10), value: Number(r.value) }))
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getBlsSeries(seriesIds, apiKey, startYear, endYear) {
  const body = {
    seriesid: seriesIds,
    startyear: String(startYear),
    endyear: String(endYear),
    registrationkey: apiKey
  };

  const json = await fetchJson("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (json.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS request failed: ${json.message || json.status}`);
  }

  const out = {};
  for (const series of json.Results?.series || []) {
    out[series.seriesID] = (series.data || [])
      .filter((r) => /^M\d{2}$/.test(r.period))
      .map((r) => ({
        date: `${r.year}-${r.period.slice(1)}`,
        value: Number(r.value)
      }))
      .filter((r) => Number.isFinite(r.value))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

async function discoverBeaCorePceLine(apiKey, config) {
  const needles = config.lineDescriptionNeedles || [];
  for (const tableName of config.tableCandidates || []) {
    const url = new URL("https://apps.bea.gov/api/data");
    url.searchParams.set("UserID", apiKey);
    url.searchParams.set("method", "GETPARAMETERVALUESFILTERED");
    url.searchParams.set("datasetname", "NIPA");
    url.searchParams.set("TargetParameter", "LineNumber");
    url.searchParams.set("TableName", tableName);
    url.searchParams.set("Frequency", "M");
    url.searchParams.set("ResultFormat", "JSON");

    const json = await fetchJson(url);
    const values = json.BEAAPI?.Results?.ParamValue || [];
    const match = values.find((v) => {
      const desc = String(v.Desc || v.Description || v.LineDescription || "").toLowerCase();
      return needles.some((needle) => desc.includes(needle));
    });
    if (match) {
      return { tableName, lineNumber: String(match.Key || match.LineNumber || match.Value), description: match.Desc || match.Description || "" };
    }
  }
  throw new Error("Could not discover BEA core PCE line from candidate NIPA tables");
}

async function getBeaNipaSeries(apiKey, tableName, lineNumber) {
  const url = new URL("https://apps.bea.gov/api/data");
  url.searchParams.set("UserID", apiKey);
  url.searchParams.set("method", "GetData");
  url.searchParams.set("datasetname", "NIPA");
  url.searchParams.set("TableName", tableName);
  url.searchParams.set("LineNumber", lineNumber);
  url.searchParams.set("Frequency", "M");
  url.searchParams.set("Year", "X");
  url.searchParams.set("ResultFormat", "JSON");

  const json = await fetchJson(url);
  const rows = json.BEAAPI?.Results?.Data || [];
  return rows
    .map((r) => ({
      date: normalizeBeaPeriod(r.TimePeriod),
      value: Number(String(r.DataValue || "").replace(/,/g, ""))
    }))
    .filter((r) => r.date && Number.isFinite(r.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getCensusMartsSeries(apiKey, config) {
  const url = new URL(`https://api.census.gov/data/${config.dataset}`);
  Object.entries(config.params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("time", "from 2015-01");
  url.searchParams.set("key", apiKey);

  const rows = await fetchJson(url);
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("Census MARTS returned no rows");
  const header = rows[0];
  const cellIdx = header.indexOf("cell_value");
  const timeIdx = header.indexOf("time_slot_id") >= 0 ? header.indexOf("time_slot_id") : header.indexOf("time");
  if (cellIdx < 0 || timeIdx < 0) throw new Error("Census MARTS response missing expected columns");

  return rows.slice(1)
    .map((r) => ({
      date: normalizeMonth(String(r[timeIdx])),
      value: Number(String(r[cellIdx]).replace(/,/g, ""))
    }))
    .filter((r) => r.date && Number.isFinite(r.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function prepareSeries(observations, transform) {
  if (transform === "level_monthly_last") {
    return monthlyLast(observations);
  }

  if (transform === "index_yoy") {
    const monthly = monthlyLast(observations);
    const byDate = new Map(monthly.map((r) => [r.date, r.value]));
    return monthly.map((r) => {
      const prevDate = shiftMonth(r.date, -12);
      const prev = byDate.get(prevDate);
      if (!prev) return null;
      return { date: r.date, value: pctChange(r.value, prev), raw_value: r.value };
    }).filter(Boolean);
  }

  if (transform === "monthly_change") {
    const monthly = monthlyLast(observations);
    return monthly.map((r, i) => {
      if (i === 0) return null;
      return { date: r.date, value: r.value - monthly[i - 1].value, raw_value: r.value };
    }).filter(Boolean);
  }

  throw new Error(`Unsupported transform: ${transform}`);
}

function buildUpdateFromSeries(id, config, series) {
  if (!series || series.length < 12) throw new Error(`${id} has fewer than 12 prepared observations`);

  const latest = series[series.length - 1];
  const last12 = series.slice(-12).map((r) => ({ date: r.date, value: round1(r.value) }));
  const tenYears = series.filter((r) => r.date >= yyyymm(yearsAgoDate(10)));
  const pre2020 = findBaseline(series, PRE_2020_BASELINES[id]?.date);

  const update = {
    current_value: formatCurrentValue(latest.value, config.valueFormat),
    data_points: last12,
    compared_to: {
      vs_6mo: compare(latest.value, valueMonthsAgo(series, latest.date, 6), config.compareMode),
      vs_12mo: compare(latest.value, valueMonthsAgo(series, latest.date, 12), config.compareMode),
      vs_pre_2020: compare(latest.value, pre2020?.value, config.compareMode)
    },
    percentile: percentile(latest.value, tenYears),
    last_updated: normalizeLastUpdated(latest.date)
  };

  if (config.sourceOverride) Object.assign(update, config.sourceOverride);
  return update;
}

function applyAllowedUpdate(signal, update, id) {
  for (const [key, value] of Object.entries(update)) {
    const isAllowed = MUTABLE_DATA_FIELDS.has(key) ||
      (id === "consumer-confidence" && CONSUMER_CONFIDENCE_SOURCE_FIELDS.has(key));
    if (!isAllowed) throw new Error(`Refusing to update non-data field ${id}.${key}`);
    signal[key] = value;
  }
}

function validateUpdate(id, update) {
  for (const field of MUTABLE_DATA_FIELDS) {
    if (!(field in update)) throw new Error(`${id} update missing ${field}`);
  }
  if (!Array.isArray(update.data_points) || update.data_points.length < 12) {
    throw new Error(`${id} update has fewer than 12 data points`);
  }
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(update.last_updated)) {
    throw new Error(`${id} last_updated is not ISO-like: ${update.last_updated}`);
  }
  if (!update.compared_to?.vs_6mo || !update.compared_to?.vs_12mo || !update.compared_to?.vs_pre_2020) {
    throw new Error(`${id} compared_to is incomplete`);
  }
  if (typeof update.percentile?.value !== "number") {
    throw new Error(`${id} percentile is incomplete`);
  }
}

function assertExpectedSignals(data) {
  const ids = new Set((data.signals || []).map((s) => s.id));
  for (const id of AUTO_SIGNAL_IDS.concat(HAND_CURATED_SIGNAL_IDS)) {
    if (!ids.has(id)) throw new Error(`Missing expected signal: ${id}`);
  }
}

function assertEditorialPreserved(before, after) {
  const strippedBefore = stripMutableData(JSON.parse(JSON.stringify(before)));
  const strippedAfter = stripMutableData(JSON.parse(JSON.stringify(after)));
  const b = JSON.stringify(strippedBefore);
  const a = JSON.stringify(strippedAfter);
  if (a !== b) {
    throw new Error("Editorial-preservation guard failed: a non-data field changed");
  }
}

function stripMutableData(data) {
  for (const signal of data.signals || []) {
    if (!AUTO_SIGNAL_IDS.includes(signal.id)) continue;
    for (const key of MUTABLE_DATA_FIELDS) delete signal[key];
    if (signal.id === "consumer-confidence") {
      for (const key of CONSUMER_CONFIDENCE_SOURCE_FIELDS) delete signal[key];
    }
  }
  return data;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${text.slice(0, 200)}`);
  }
}

function monthlyLast(observations) {
  const byMonth = new Map();
  for (const r of observations) {
    const m = normalizeMonth(r.date);
    if (!m) continue;
    byMonth.set(m, { date: m, value: r.value });
  }
  return Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeMonth(s) {
  const str = String(s || "");
  const direct = str.match(/^(\d{4})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}`;
  const compact = str.match(/^(\d{4})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}`;
  return null;
}

function normalizeBeaPeriod(s) {
  const str = String(s || "");
  const m = str.match(/^(\d{4})M(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  return normalizeMonth(str);
}

function normalizeLastUpdated(date) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-01`;
  return date;
}

function shiftMonth(yyyyMm, delta) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function valueMonthsAgo(series, latestDate, months) {
  const target = shiftMonth(latestDate.slice(0, 7), -months);
  return series.find((r) => r.date === target)?.value;
}

function findBaseline(series, baselineMonth) {
  if (!baselineMonth) return null;
  return series.find((r) => r.date === baselineMonth) ||
    series.find((r) => r.date > baselineMonth);
}

function compare(latest, previous, mode) {
  if (previous == null || !Number.isFinite(previous)) {
    return { direction: "flat", delta_pct: 0, tone: "neutral" };
  }
  const delta = mode === "percent" ? pctChange(latest, previous) : latest - previous;
  const rounded = round1(delta);
  const direction = rounded > 0.05 ? "up" : (rounded < -0.05 ? "down" : "flat");
  return { direction, delta_pct: rounded, tone: toneForDelta(rounded) };
}

function percentile(value, series) {
  const vals = series.map((r) => r.value).filter(Number.isFinite).sort((a, b) => a - b);
  if (!vals.length) return { value: 50, lookback_years: 10, label: "Insufficient history for percentile" };
  const belowOrEqual = vals.filter((v) => v <= value).length;
  const pct = Math.max(0, Math.min(100, Math.round((belowOrEqual / vals.length) * 100)));
  return {
    value: pct,
    lookback_years: 10,
    label: pct >= 50
      ? `Higher than ${100 - pct}% of observations in the last 10 years`
      : `Lower than ${100 - pct}% of observations in the last 10 years`
  };
}

function toneForDelta(delta) {
  if (Math.abs(delta) < 0.1) return "neutral";
  return delta > 0 ? "amber" : "green";
}

function pctChange(a, b) {
  if (!b) return 0;
  return ((a - b) / Math.abs(b)) * 100;
}

function formatCurrentValue(value, format) {
  if (format === "percent") return `${round2(value)}%`;
  if (format === "trillions") return `$${round2(value / 1000000)}T`;
  if (format === "jobs_k") return `${value >= 0 ? "+" : ""}${Math.round(value)}k`;
  if (format === "number_1") return String(round1(value));
  return String(round1(value));
}

function round1(n) { return Math.round(Number(n) * 10) / 10; }
function round2(n) { return Math.round(Number(n) * 100) / 100; }
function yyyymm(date) { return date.slice(0, 7); }

function yearsAgoDate(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var ${name}. Use --dry-run locally; keep keys in GitHub Secrets.`);
  return val;
}

function log(msg) {
  console.log(`[pulse-data] ${msg}`);
}

main().catch((err) => {
  console.error(`[pulse-data] Fatal: ${err.message}`);
  process.exit(1);
});
