/* ========================================================================
   ProductSnap Studio — Pulse shared source-fetch + transform library

   Single source of truth for:
     - the per-signal source configuration (provider, series id, transform)
     - fetching observations from FRED / BLS
     - transforming raw observations into the prepared series
     - formatting the displayed current_value

   Both scripts/fetch-pulse-data.js (the writer) and
   scripts/verify-pulse-sources.js (the independent gate) import from here so
   that verification compares the stored value against the SAME transform the
   writer used. Verifying against a different code path would be meaningless.

   Dependency-free: Node built-ins only (global fetch on Node 20+). No npm.
   ======================================================================== */

"use strict";

// ---- Per-signal source configuration -----------------------------------
// IDs here are exactly the 10 automated signals. Curated Tier-2/3 signals are
// intentionally absent: they have no free API and are not source-verifiable.
const SIGNAL_CONFIG = {
  "cpi-headline": {
    provider: "bls",
    seriesId: "CUUR0000SA0",
    companionSeriesIds: ["CUUR0000SA0L1E"],
    transform: "index_yoy",
    valueFormat: "percent",
    compareMode: "points",
    sourceNote: "BLS CPI · monthly release",
    cadence: "monthly"
  },
  "ppi": {
    provider: "bls",
    seriesId: "WPSFD4",
    transform: "index_yoy",
    valueFormat: "percent",
    compareMode: "points",
    sourceNote: "BLS PPI Final Demand · monthly release",
    cadence: "monthly"
  },
  "nonfarm-payrolls": {
    provider: "bls",
    seriesId: "CES0000000001",
    transform: "monthly_change",
    valueFormat: "jobs_k",
    compareMode: "percent",
    sourceNote: "BLS Employment Situation · monthly release",
    cadence: "monthly"
  },
  "pce": {
    provider: "fred",
    seriesId: "PCEPILFE",
    transform: "index_yoy",
    valueFormat: "percent",
    compareMode: "points",
    sourceNote: "FRED PCEPILFE · monthly release",
    cadence: "monthly"
  },
  "fed-net-liquidity": {
    provider: "fred",
    seriesId: "WALCL",
    transform: "level_monthly_last",
    valueFormat: "trillions",
    compareMode: "percent",
    sourceNote: "FRED WALCL · weekly",
    latestFromRaw: true,
    cadence: "weekly"
  },
  "10y-treasury": {
    provider: "fred",
    seriesId: "DGS10",
    transform: "level_monthly_last",
    valueFormat: "percent",
    compareMode: "points",
    sourceNote: "FRED DGS10 · daily",
    latestFromRaw: true,
    cadence: "daily"
  },
  "retail-sales": {
    provider: "fred",
    seriesId: "RSAFS",
    transform: "index_yoy",
    valueFormat: "percent",
    compareMode: "points",
    sourceNote: "FRED RSAFS · monthly release",
    cadence: "monthly"
  },
  "consumer-confidence": {
    provider: "fred",
    seriesId: "UMCSENT",
    transform: "level_monthly_last",
    valueFormat: "number_1",
    compareMode: "percent",
    sourceNote: "University of Michigan Consumer Sentiment · via FRED",
    cadence: "monthly",
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
  },
  "mfg-activity": {
    provider: "fred",
    seriesId: "GACDFSA066MSFRBPHI",
    transform: "level_monthly_last",
    valueFormat: "number_1",
    compareMode: "points",
    sourceNote: "Philadelphia Fed Manufacturing Business Outlook Survey · via FRED",
    cadence: "monthly"
  },
  "services-activity": {
    provider: "fred",
    seriesId: "TSSOSBACTUAMFRBDAL",
    transform: "level_monthly_last",
    valueFormat: "number_1",
    compareMode: "points",
    sourceNote: "Dallas Fed Texas Service Sector Outlook Survey · via FRED",
    cadence: "monthly"
  }
};

const AUTO_SIGNAL_IDS = Object.keys(SIGNAL_CONFIG);

// Public FRED series page for a given series id (used for honest source URLs in
// the verification artifact).
function fredSeriesUrl(seriesId) {
  return `https://fred.stlouisfed.org/series/${seriesId}`;
}
function blsSeriesUrl(seriesId) {
  return `https://data.bls.gov/timeseries/${seriesId}`;
}
function sourceUrlFor(config) {
  if (config.provider === "fred") return fredSeriesUrl(config.seriesId);
  if (config.provider === "bls") return blsSeriesUrl(config.seriesId);
  return null;
}

// ---- HTTP -------------------------------------------------------------
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

// ---- Transforms -------------------------------------------------------
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

function monthlyLast(observations) {
  const byMonth = new Map();
  for (const r of observations) {
    const m = normalizeMonth(r.date);
    if (!m) continue;
    byMonth.set(m, { date: m, value: r.value });
  }
  return Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Fetch + prepare a signal's full prepared series + raw latest ------
// Returns { prepared: [{date,value,...}], rawLatest: {date,value}|null }.
// Used by both the writer (to build data fields) and the verifier (to
// independently re-derive what current_value SHOULD be).
async function fetchPreparedSeries(id, config, env) {
  if (config.provider === "fred") {
    const key = requireEnv(env, "FRED_API_KEY");
    const observations = await getFredObservations(config.seriesId, key, yearsAgoDate(11));
    const prepared = prepareSeries(observations, config.transform);
    const rawLatest = observations.length ? observations[observations.length - 1] : null;
    return { prepared, rawLatest };
  }
  if (config.provider === "bls") {
    const key = requireEnv(env, "BLS_API_KEY");
    const seriesIds = [config.seriesId].concat(config.companionSeriesIds || []);
    const nowYear = new Date().getFullYear();
    const seriesMap = await getBlsSeries(seriesIds, key, nowYear - 11, nowYear);
    const observations = seriesMap[config.seriesId];
    if (!observations || observations.length < 13) {
      throw new Error(`BLS series ${config.seriesId} returned too few observations`);
    }
    const prepared = prepareSeries(observations, config.transform);
    return { prepared, rawLatest: null };
  }
  throw new Error(`Unsupported provider: ${config.provider}`);
}

// Derive the displayed current_value + last_updated the SAME way the writer
// does (including the latestFromRaw rule for sub-monthly cadence series).
function deriveCurrent(config, prepared, rawLatest) {
  if (!prepared || prepared.length === 0) {
    throw new Error("no prepared observations");
  }
  const latest = prepared[prepared.length - 1];
  let current_value = formatCurrentValue(latest.value, config.valueFormat);
  let last_updated = normalizeLastUpdated(latest.date);
  if (config.latestFromRaw && rawLatest) {
    current_value = formatCurrentValue(rawLatest.value, config.valueFormat);
    last_updated = normalizeLastUpdated(rawLatest.date);
  }
  return { current_value, last_updated };
}

// ---- Formatting + small date/number helpers (verbatim from fetcher) ----
function formatCurrentValue(value, format) {
  if (format === "percent") return `${round2(value)}%`;
  if (format === "trillions") return `$${round2(value / 1000000)}T`;
  if (format === "jobs_k") return `${value >= 0 ? "+" : ""}${Math.round(value)}k`;
  if (format === "number_1") return String(round1(value));
  return String(round1(value));
}

function normalizeMonth(s) {
  const str = String(s || "");
  const direct = str.match(/^(\d{4})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}`;
  const compact = str.match(/^(\d{4})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}`;
  return null;
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

function pctChange(a, b) {
  if (!b) return 0;
  return ((a - b) / Math.abs(b)) * 100;
}

function round1(n) { return Math.round(Number(n) * 10) / 10; }
function round2(n) { return Math.round(Number(n) * 100) / 100; }

function yearsAgoDate(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function requireEnv(env, name) {
  const src = env || process.env;
  const val = src[name];
  if (!val) throw new Error(`Missing required env var ${name}. Keep keys in GitHub Secrets.`);
  return val;
}

module.exports = {
  SIGNAL_CONFIG,
  AUTO_SIGNAL_IDS,
  fetchPreparedSeries,
  prepareSeries,
  deriveCurrent,
  formatCurrentValue,
  getFredObservations,
  getBlsSeries,
  monthlyLast,
  normalizeMonth,
  normalizeLastUpdated,
  shiftMonth,
  pctChange,
  round1,
  round2,
  yearsAgoDate,
  sourceUrlFor,
  fredSeriesUrl,
  blsSeriesUrl
};
