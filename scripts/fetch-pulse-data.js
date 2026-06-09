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
     FRED_API_KEY, BLS_API_KEY
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
  "nonfarm-payrolls",
  "mfg-activity",
  "services-activity"
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
  "last_updated",
  // Pass F: per-signal timestamps object. Only latest_source_data_date is
  // touched by the fetcher (when the source publishes a newer observation).
  // last_editorial_reviewed is never written here — it moves only on prose
  // edits. There is NO per-signal pipeline timestamp; the single site-level
  // phase_meta.last_pipeline_refresh proves the pipeline is alive (see below).
  "timestamps"
]);

// Track 2: data fields the fetcher MAY write but that are not strictly
// required on every update (so older/curated paths that omit them still pass
// validation). data_points_window_months documents how many months of history
// the sparkline actually carries (<=36).
const OPTIONAL_DATA_FIELDS = new Set([
  "data_points_window_months"
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
    // FRED series PCEPILFE: Personal Consumption Expenditures Excluding Food
    // and Energy (Chain-Type Price Index). Monthly index; YoY % change is
    // computed against the same month of the prior year.
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
    // FRED series RSAFS: Advance Retail Sales — Retail and Food Services,
    // Total. Monthly level; YoY % change is computed against the same month
    // of the prior year.
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
    // Philadelphia Fed Manufacturing Business Outlook Survey, Current General
    // Activity Diffusion Index, seasonally adjusted. Monthly. Free via FRED.
    // This is a REGIONAL proxy for national manufacturing activity, not the
    // proprietary ISM Manufacturing PMI. Diffusion-index level (typical range
    // ~-40 to +40), positive = expanding, negative = contracting.
    provider: "fred",
    seriesId: "GACDFSA066MSFRBPHI",
    transform: "level_monthly_last",
    valueFormat: "number_1",
    compareMode: "points",
    sourceNote: "Philadelphia Fed Manufacturing Business Outlook Survey · via FRED",
    cadence: "monthly"
  },
  "services-activity": {
    // Dallas Fed Texas Service Sector Outlook Survey, Current General Business
    // Activity Diffusion Index, seasonally adjusted. Monthly. Free via FRED.
    // This is a REGIONAL proxy for national services activity, not the
    // proprietary ISM Services PMI. Diffusion-index level, positive =
    // expanding, negative = contracting.
    provider: "fred",
    seriesId: "TSSOSBACTUAMFRBDAL",
    transform: "level_monthly_last",
    valueFormat: "number_1",
    compareMode: "points",
    sourceNote: "Dallas Fed Texas Service Sector Outlook Survey · via FRED",
    cadence: "monthly"
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
  "consumer-confidence": { date: "2020-01" },
  "mfg-activity": { date: "2020-01" },
  "services-activity": { date: "2020-01" }
};

// Per-signal tone policy. Direction is computed mechanically from the delta,
// but tone reflects product interpretation:
//   - "up_bad"  : an increase is amber, a decrease is green
//   - "up_good" : an increase is green, a decrease is amber
//   - "neutral" : no opinion either way; tone stays neutral
// The previous default treated every "up" as amber, which produced wrong
// reads (e.g. consumer sentiment falling marked green).
const TONE_POLICY = {
  "cpi-headline": "up_bad",        // higher inflation is amber
  "ppi": "up_bad",                  // higher producer prices is amber
  "pce": "up_bad",                  // higher core PCE is amber
  "10y-treasury": "up_bad",         // higher borrowing costs is amber
  "fed-net-liquidity": "up_good",   // tightening liquidity is amber
  "consumer-confidence": "up_good", // lower sentiment is amber
  "retail-sales": "up_good",        // sharp slowdown is amber
  "nonfarm-payrolls": "up_good",    // sharp cooling is amber
  "mfg-activity": "up_good",        // rising diffusion = expansion = green
  "services-activity": "up_good"    // rising diffusion = expansion = green
};

const FLAT_THRESHOLD_DEFAULT = 0.05;
const NEUTRAL_TONE_THRESHOLD_DEFAULT = 0.1;

// Freshness thresholds (in days) past which the latest observation is flagged
// as older than expected for its source cadence. Warnings only — never a hard
// failure, because some source lag is genuine (e.g. core PCE for month M
// publishes ~last week of month M+1). The intent is visibility, so a stale
// signal does not silently persist across multiple refreshes unnoticed.
//
// Age is computed from the *end* of the labeled period, not from period-start.
// Monthly economic series carry a period-start date (e.g. 2026-04-01 for April
// data), but the release lands ~mid-to-late of the following month. Measuring
// from period-end keeps the threshold meaningful: ~45 days past the period end
// is roughly two missed releases for monthly, which is the point at which a
// stuck fetch becomes actionable rather than just expected lag.
const FRESHNESS_THRESHOLD_DAYS = {
  daily: 4,
  weekly: 14,
  monthly: 45
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

  // Pass F: stamp the single site-level pipeline-refresh timestamp on every
  // run, regardless of whether any source data changed. This proves the cron
  // is alive (it "checked" all signals — including manual/event-driven ones,
  // which it skips) and produces only a small top-level diff on quiet days.
  // No per-signal pipeline timestamp is written, so quiet days never churn the
  // signals array.
  next.phase_meta = next.phase_meta || {};
  next.phase_meta.last_pipeline_refresh = new Date().toISOString();

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
      log(`⚠ FETCH FAILURE: ${id} failed this run; kept last-known-good data (${err.message})`);
    }
  }

  assertEditorialPreserved(original, next);

  runFreshnessGuard(next, new Set(failures.map((f) => f.id)));

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
  const rawLatest = observations.length ? observations[observations.length - 1] : null;
  return buildUpdateFromSeries(id, { ...config, rawLatest }, prepared);
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
  // Track 2: store a rolling 36-month sparkline (was 12). We store whatever
  // history actually exists up to 36 points — never fabricate missing months.
  const last36 = series.slice(-36).map((r) => ({ date: r.date, value: round1(r.value) }));
  const tenYears = series.filter((r) => r.date >= yyyymm(yearsAgoDate(10)));
  const pre2020 = findBaseline(series, PRE_2020_BASELINES[id]?.date);
  const range36 = rangeOverWindow(series, latest.date, 36);

  const update = {
    current_value: formatCurrentValue(latest.value, config.valueFormat),
    data_points: last36,
    // How many months of history this sparkline actually carries (<=36). Lets
    // the UI label the window honestly when a young series has fewer points.
    data_points_window_months: last36.length,
    compared_to: {
      // Reference points for a layperson: "vs last month / 6mo / 1yr / 3yr".
      vs_1mo: compare(latest.value, valueMonthsAgo(series, latest.date, 1), config.compareMode, id),
      vs_6mo: compare(latest.value, valueMonthsAgo(series, latest.date, 6), config.compareMode, id),
      vs_12mo: compare(latest.value, valueMonthsAgo(series, latest.date, 12), config.compareMode, id),
      vs_36mo: compare(latest.value, valueMonthsAgo(series, latest.date, 36), config.compareMode, id),
      vs_pre_2020: compare(latest.value, pre2020?.value, config.compareMode, id),
      // 3-year high/low gives "is this an extreme or normal?" context at a glance.
      range_36mo: range36
    },
    percentile: percentile(latest.value, tenYears),
    last_updated: normalizeLastUpdated(latest.date)
  };

  // For sub-monthly cadence series (FRED daily/weekly), the monthly sparkline
  // is the right shape for data_points, but current_value/last_updated should
  // reflect the latest actual raw observation rather than the month-aggregated
  // value. Otherwise a Wednesday rate print disappears behind a stale month-end.
  if (config.latestFromRaw && config.rawLatest) {
    update.current_value = formatCurrentValue(config.rawLatest.value, config.valueFormat);
    update.last_updated = normalizeLastUpdated(config.rawLatest.date);
  }

  if (config.sourceOverride) Object.assign(update, config.sourceOverride);
  return update;
}

function applyAllowedUpdate(signal, update, id) {
  for (const [key, value] of Object.entries(update)) {
    const isAllowed = MUTABLE_DATA_FIELDS.has(key) ||
      OPTIONAL_DATA_FIELDS.has(key) ||
      (id === "consumer-confidence" && CONSUMER_CONFIDENCE_SOURCE_FIELDS.has(key));
    if (!isAllowed) throw new Error(`Refusing to update non-data field ${id}.${key}`);
    signal[key] = value;
  }
  // Pass F: keep the per-signal timestamps block in sync with the newly applied
  // source observation. latest_source_data_date tracks the freshness of the
  // number (mirrors last_updated, kept for backward compatibility). The fetcher
  // NEVER touches last_editorial_reviewed — that moves only on prose edits — so
  // it is preserved as-is. No per-signal pipeline timestamp is written.
  if (update.last_updated != null) {
    const prevTs = (signal.timestamps && typeof signal.timestamps === "object")
      ? signal.timestamps : {};
    signal.timestamps = {
      latest_source_data_date: update.last_updated,
      last_editorial_reviewed: prevTs.last_editorial_reviewed != null
        ? prevTs.last_editorial_reviewed
        : null
    };
  }
}

function validateUpdate(id, update) {
  for (const field of MUTABLE_DATA_FIELDS) {
    // timestamps is derived by applyAllowedUpdate from last_updated rather than
    // produced by the source-fetch builders, so it is not a required input.
    if (field === "timestamps") continue;
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
  // Track 2: the enriched reference points must be present and well-formed.
  if (!update.compared_to?.vs_1mo || !update.compared_to?.vs_36mo) {
    throw new Error(`${id} compared_to missing vs_1mo/vs_36mo`);
  }
  const r = update.compared_to?.range_36mo;
  if (!r || typeof r.high !== "number" || typeof r.low !== "number" || r.high < r.low) {
    throw new Error(`${id} compared_to.range_36mo is incomplete or inverted`);
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

// Warn (never fail) when any auto-fetched signal's latest observation date is
// older than its expected cadence allows. Runs against the post-merge state,
// so it also catches signals whose fetch failed and stuck on last-known-good.
// Output is parseable from Actions logs: lines start with "⚠ FRESHNESS:" or
// "⚠ FETCH FAILURE:". A signal that failed to fetch this run is always flagged,
// even if last_known_good has a recent timestamp.
function runFreshnessGuard(data, failedIds = new Set()) {
  const today = new Date();
  const stale = [];
  for (const id of AUTO_SIGNAL_IDS) {
    const config = SIGNAL_CONFIG[id];
    const signal = (data.signals || []).find((s) => s.id === id);
    if (!signal || !config?.cadence) continue;
    if (failedIds.has(id)) {
      log(`⚠ FETCH FAILURE: ${id} failed this run; last_updated=${signal.last_updated || "n/a"} kept (last-known-good)`);
      stale.push(id);
      continue;
    }
    const threshold = FRESHNESS_THRESHOLD_DAYS[config.cadence];
    if (!threshold) continue;
    const lastUpdatedRaw = signal.last_updated;
    if (!lastUpdatedRaw) {
      log(`⚠ FRESHNESS: ${id} has no last_updated; expected ${config.cadence} cadence`);
      stale.push(id);
      continue;
    }
    const normalized = normalizeLastUpdated(lastUpdatedRaw);
    const lastDate = new Date(`${normalized}T00:00:00Z`);
    if (Number.isNaN(lastDate.getTime())) {
      log(`⚠ FRESHNESS: ${id} last_updated is unparseable (${lastUpdatedRaw})`);
      stale.push(id);
      continue;
    }
    // For monthly signals the date marks the period start; treat the end of
    // that month as "data is at least this fresh" before counting age.
    const referenceDate = config.cadence === "monthly"
      ? endOfMonth(lastDate)
      : lastDate;
    const ageDays = Math.floor((today.getTime() - referenceDate.getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays > threshold) {
      log(`⚠ FRESHNESS: ${id} latest point is ${lastUpdatedRaw} (${ageDays}d past period-end), older than expected for ${config.cadence} cadence (>${threshold}d)`);
      stale.push(id);
    }
  }
  if (!stale.length) {
    log(`Freshness OK: all ${AUTO_SIGNAL_IDS.length} auto signals within cadence thresholds.`);
  }
}

function stripMutableData(data) {
  for (const signal of data.signals || []) {
    if (!AUTO_SIGNAL_IDS.includes(signal.id)) continue;
    for (const key of MUTABLE_DATA_FIELDS) delete signal[key];
    // Track 2 fix: OPTIONAL_DATA_FIELDS (e.g. data_points_window_months) are
    // fields the fetcher is ALLOWED to write (see applyAllowedUpdate), so they
    // must also be excluded from the editorial-preservation comparison. Without
    // this, a newly-written optional field is absent in `before` but present in
    // `after` and the guard wrongly reports "a non-data field changed".
    for (const key of OPTIONAL_DATA_FIELDS) delete signal[key];
    if (signal.id === "consumer-confidence") {
      for (const key of CONSUMER_CONFIDENCE_SOURCE_FIELDS) delete signal[key];
    }
  }
  // Pass F: the site-level pipeline-refresh timestamp is intentionally rewritten
  // on every run, so exclude it from the editorial-preservation comparison.
  // Everything else under phase_meta stays guarded.
  if (data.phase_meta && typeof data.phase_meta === "object") {
    delete data.phase_meta.last_pipeline_refresh;
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

function normalizeLastUpdated(date) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-01`;
  return date;
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
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

// Track 2: high/low (and their dates) over the trailing `months` window ending
// at latestDate. Uses whatever history exists in that window — never fabricates
// points. Returns { high, low, high_date, low_date, window_months } where
// window_months is the count of observations actually considered.
function rangeOverWindow(series, latestDate, months) {
  const end = latestDate.slice(0, 7);
  const start = shiftMonth(end, -(months - 1));
  // series rows carry YYYY-MM dates; bound inclusively on the month prefix.
  const window = series.filter((r) => {
    const m = r.date.slice(0, 7);
    return m >= start && m <= end;
  });
  const pts = window.length ? window : series.slice(-1);
  let hi = pts[0], lo = pts[0];
  for (const r of pts) {
    if (r.value > hi.value) hi = r;
    if (r.value < lo.value) lo = r;
  }
  return {
    high: round1(hi.value),
    low: round1(lo.value),
    high_date: hi.date,
    low_date: lo.date,
    window_months: pts.length
  };
}

function findBaseline(series, baselineMonth) {
  if (!baselineMonth) return null;
  return series.find((r) => r.date === baselineMonth) ||
    series.find((r) => r.date > baselineMonth);
}

function compare(latest, previous, mode, signalId) {
  if (previous == null || !Number.isFinite(previous)) {
    return { direction: "flat", delta_pct: 0, tone: "neutral" };
  }
  const delta = mode === "percent" ? pctChange(latest, previous) : latest - previous;
  const rounded = round1(delta);
  const direction = rounded > FLAT_THRESHOLD_DEFAULT ? "up" : (rounded < -FLAT_THRESHOLD_DEFAULT ? "down" : "flat");
  return { direction, delta_pct: rounded, tone: toneForDelta(rounded, signalId) };
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

function toneForDelta(delta, signalId) {
  if (Math.abs(delta) < NEUTRAL_TONE_THRESHOLD_DEFAULT) return "neutral";
  const policy = TONE_POLICY[signalId];
  if (policy === "up_good") return delta > 0 ? "green" : "amber";
  if (policy === "neutral") return "neutral";
  // Default: "up_bad" — higher value is amber, lower is green. Used for
  // inflation-style series (CPI, PPI, PCE) and borrowing costs (10y).
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
