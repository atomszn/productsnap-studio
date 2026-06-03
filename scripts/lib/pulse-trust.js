/* =====================================================================
   pulse-trust.js  —  shared trust / validation library  (Pass D)
   ---------------------------------------------------------------------
   Dependency-free (Node standard library only). Pure functions: no
   network, no process.exit, no file writes. The fetch script and the
   validate/report script both consume this module.

   Responsibilities:
     - parse loose value strings ("3.81%", "$6.7T", "+115k", "~210") to numbers
     - validate a candidate update for a single signal against the registry
     - compute editorial alignment (data direction vs editorial stance)
     - decide the machine status: verified | stale | needs_review | failed | manual
     - last-known-good protection helpers

   The validator never mutates inputs. Callers decide whether to apply a
   candidate value or preserve the previous trusted value based on the
   returned verdict.
   ===================================================================== */
"use strict";

/* ---------- value parsing ---------- */

// Turn a loose display value into a number when possible.
// Handles: "3.81%", "5.99%", "$6.7T", "+115k", "-0.4", "~210", "+38%",
// "−60%" (unicode minus), "22nd percentile", "3 / 14 days".
function parseLooseNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/\u2212/g, "-"); // unicode minus -> ascii

  // "3 / 14 days" -> take the leading count (releases per window)
  const slash = s.match(/^([+-]?\d+(?:\.\d+)?)\s*\/\s*\d/);
  if (slash) return Number(slash[1]);

  // grab first signed number, possibly with $ prefix and T/B/M/k suffix
  const m = s.match(/([+-]?)\s*\$?\s*(\d+(?:\.\d+)?)\s*([TBMK%]|bn|th|nd|st|rd)?/i);
  if (!m) return null;
  let n = Number(m[2]);
  if (!isFinite(n)) return null;
  if (m[1] === "-") n = -n;
  const suf = (m[3] || "").toUpperCase();
  if (suf === "T") n *= 1e0;       // keep trillions as-is (e.g. 6.7) — unit is "trillions"
  if (suf === "K") n *= 1;          // keep "115k" as 115 (unit is thousands)
  // percent / ordinals: numeric face value is what we validate against ranges
  return n;
}

function isValidISODate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(String(s) + "T00:00:00Z");
  return !isNaN(d.getTime());
}

// Accept "2026-04" (month) or "2026-04-01" (day). Returns a comparable Date or null.
function toComparableDate(s) {
  if (!s) return null;
  const str = String(s);
  if (/^\d{4}-\d{2}$/.test(str)) return new Date(str + "-01T00:00:00Z");
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return new Date(str.slice(0, 10) + "T00:00:00Z");
  return null;
}

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

/* ---------- registry helpers ---------- */

function getRegistryEntry(registry, signalId) {
  return (registry.signals || []).find((s) => s.signal_id === signalId) || null;
}

/* ---------- core: validate a candidate update ---------- */
/*
  candidate = {
    signal_id,
    value,            // new display value (string or number) OR null if categorical/manual
    date,             // ISO date of the new observation ("2026-05-01")
    unit,             // unit string reported by the source
    source_series,    // optional: what mapping the fetcher used
  }
  prev = {
    value, last_updated, unit         // last-known-good (from content json)
  }
  options = { now: Date }

  Returns:
    {
      signal_id, ok, status, checks: [...], failures: [...],
      parsed_value, parsed_prev, reason
    }
  status is one of: verified | stale | needs_review | failed | manual
*/
function validateSignalUpdate(registry, candidate, prev, options) {
  options = options || {};
  const now = options.now ? new Date(options.now) : new Date();
  const entry = getRegistryEntry(registry, candidate.signal_id);
  const checks = [];
  const failures = [];

  function check(name, pass, detail, severity) {
    checks.push({ name, pass: !!pass, detail: detail || "", severity: severity || (pass ? "ok" : "fail") });
    if (!pass) failures.push({ name, detail: detail || "", severity: severity || "fail" });
  }

  if (!entry) {
    return {
      signal_id: candidate.signal_id, ok: false, status: "failed",
      checks: [], failures: [{ name: "registry_lookup", detail: "no registry entry", severity: "fail" }],
      reason: "Signal not present in registry"
    };
  }

  const v = entry.validation || {};
  const th = entry.thresholds || {};
  const cad = entry.cadence || {};
  const isManual = entry.status_type === "manual";
  const numericExpected = v.require_numeric !== false && v.value_type !== "categorical";

  const parsedValue = parseLooseNumber(candidate.value);
  const parsedPrev = parseLooseNumber(prev && prev.value);

  // 1. value present
  if (v.require_value_present) {
    const present = candidate.value != null && String(candidate.value).trim() !== "";
    check("value_present", present, present ? "" : "value missing/empty");
  }

  // 2. numeric parse (only when numeric expected)
  if (numericExpected) {
    check("value_numeric", parsedValue != null,
      parsedValue != null ? ("parsed=" + parsedValue) : ("could not parse value: " + candidate.value));
  } else {
    check("value_categorical", true, "categorical/manual signal — numeric checks skipped", "ok");
  }

  // 3. unit match
  if (v.require_unit_match && candidate.unit != null && entry.unit != null) {
    const match = normUnit(candidate.unit) === normUnit(entry.unit);
    check("unit_match", match, match ? "" : ('expected "' + entry.unit + '" got "' + candidate.unit + '"'),
      match ? "ok" : "warn");
  }

  // 4. source mapping correct
  if (v.require_source_mapping && candidate.source_series) {
    const exp = entry.source_series || {};
    const got = candidate.source_series || {};
    const ok = (exp.provider || null) === (got.provider || null) &&
               (exp.series_id || null) === (got.series_id || null);
    check("source_mapping", ok, ok ? "" :
      ("expected " + JSON.stringify(exp) + " got " + JSON.stringify(got)));
  }

  // 5. date validity + not future
  let dateOk = true;
  if (v.require_valid_date && candidate.date != null) {
    dateOk = isValidISODate(candidate.date) || /^\d{4}-\d{2}$/.test(String(candidate.date));
    check("date_valid", dateOk, dateOk ? "" : ("invalid date: " + candidate.date));
  }
  if (v.reject_future_dates && candidate.date != null) {
    const cd = toComparableDate(candidate.date);
    const future = cd && cd.getTime() > now.getTime();
    check("date_not_future", !future, future ? ("future date: " + candidate.date) : "");
  }

  // 6. non-decreasing date vs stored
  if (v.require_nondecreasing_date && candidate.date != null && prev && prev.last_updated) {
    const cd = toComparableDate(candidate.date);
    const pd = toComparableDate(prev.last_updated);
    if (cd && pd) {
      const ok = cd.getTime() >= pd.getTime();
      check("date_nondecreasing", ok, ok ? "" :
        ("new date " + candidate.date + " older than stored " + prev.last_updated));
    }
  }

  // 7. expected range
  if (numericExpected && th.expected_range && parsedValue != null) {
    const [lo, hi] = th.expected_range;
    const within = parsedValue >= lo && parsedValue <= hi;
    check("within_expected_range", within, within ? "" :
      ("value " + parsedValue + " outside [" + lo + ", " + hi + "]"), within ? "ok" : "fail");
  }

  // 8. step / outlier guards (vs previous value)
  let hardOutlier = false;
  let softOutlier = false;
  if (numericExpected && parsedValue != null && parsedPrev != null) {
    const absStep = Math.abs(parsedValue - parsedPrev);
    if (th.max_abs_step_hard != null && absStep > th.max_abs_step_hard) {
      hardOutlier = true;
      check("abs_step_hard", false,
        "abs change " + round(absStep) + " exceeds HARD limit " + th.max_abs_step_hard, "fail");
    }
    if (th.max_abs_step != null && absStep > th.max_abs_step) {
      softOutlier = true;
      check("abs_step", false,
        "abs change " + round(absStep) + " exceeds " + th.max_abs_step, "review");
    } else if (th.max_abs_step != null) {
      check("abs_step", true, "");
    }
    if (th.max_pct_step != null && parsedPrev !== 0) {
      const pctStep = Math.abs((parsedValue - parsedPrev) / parsedPrev) * 100;
      if (pctStep > th.max_pct_step) {
        softOutlier = true;
        check("pct_step", false,
          "pct change " + round(pctStep) + "% exceeds " + th.max_pct_step + "%", "review");
      } else {
        check("pct_step", true, "");
      }
    }
  }

  // 9. cadence freshness (based on the date being applied vs now)
  let stale = false;
  if (candidate.date != null && cad.stale_after_days != null) {
    const cd = toComparableDate(candidate.date);
    if (cd) {
      const age = daysBetween(now, cd);
      stale = age > cad.stale_after_days;
      check("cadence_fresh", !stale,
        stale ? ("data age " + age + "d > stale_after " + cad.stale_after_days + "d") : "",
        stale ? "warn" : "ok");
    }
  }

  /* ---------- verdict ---------- */
  // Hard failures: missing/unparseable value, invalid/future date, out of range,
  // wrong source mapping, regressing date, hard outlier.
  const hardFailNames = new Set([
    "value_present", "value_numeric", "date_valid", "date_not_future",
    "date_nondecreasing", "within_expected_range", "source_mapping", "abs_step_hard"
  ]);
  const hardFails = failures.filter((f) => hardFailNames.has(f.name));
  // Review-level breaches: soft step/pct outliers.
  const reviewFails = failures.filter((f) => f.severity === "review");

  let status, ok, reason;
  if (hardFails.length) {
    status = "failed";
    ok = false;
    reason = "Validation failed: " + hardFails.map((f) => f.name + " (" + f.detail + ")").join("; ");
  } else if (reviewFails.length || hardOutlier || softOutlier) {
    status = "needs_review";
    ok = false;
    reason = "Flagged for review: " + reviewFails.map((f) => f.name + " (" + f.detail + ")").join("; ");
  } else if (stale) {
    status = "stale";
    ok = true; // value usable but flagged stale
    reason = "Data older than cadence stale threshold";
  } else if (isManual) {
    status = "manual";
    ok = true;
    reason = "Manual/event-driven signal accepted (human-curated)";
  } else {
    status = "verified";
    ok = true;
    reason = "All checks passed";
  }

  return {
    signal_id: candidate.signal_id,
    ok, status, reason,
    parsed_value: parsedValue,
    parsed_prev: parsedPrev,
    checks, failures
  };
}

function normUnit(u) {
  return String(u || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function round(n) { return Math.round(n * 100) / 100; }

/* ---------- editorial alignment ---------- */
/*
  Detect when the editorial interpretation contradicts the measured data
  direction. Deliberately conservative: only the signal's PRIMARY editorial
  claim (its `status` word) is treated as the stance, interpreted through the
  signal's editorial_polarity. Free-text copy is NOT scanned for stance words
  (too noisy — copy routinely mentions other signals/counter-arguments).

  A mismatch requires BOTH:
    - the status word maps to a clear expected value-direction, AND
    - the authoritative data direction (curated compared_to.vs_12mo, confirmed
      against recent data_points) clearly contradicts it.

  Categorical / pattern signals and "steady/stable/mixed/rangebound" statuses
  produce alignment_status "unknown" or "aligned" (never a forced mismatch).

  Returns { alignment_status: "aligned"|"mismatch"|"unknown",
            review_required: bool, data_direction, editorial_stance,
            expected_direction, detail }
*/

// Map a signal STATUS word to an expected value-direction, taking the signal's
// editorial polarity into account. Returns "up" | "down" | "flat" | null.
//   value_up_is_negative   : inflation/yields/cost-up-is-bad (e.g. CPI)
//   value_down_is_positive : AI cost — "easing/falling" means value DOWN
//   value_up_is_positive   : confidence/hiring/sales — "weak" means value DOWN
const STATUS_WORD_DIRECTION = {
  // explicit value movement
  rising: "up", climbing: "up", surging: "up", reaccelerating: "up",
  accelerating: "up", expanding: "up", growing: "up",
  falling: "down", dropping: "down", declining: "down", contracting: "down",
  // neutral / no-direction statuses
  steady: "flat", stable: "flat", mixed: "flat", rangebound: "flat",
  flat: "flat", emerging: null, watch: null
};

// Polarity-relative qualitative statuses -> resolved by editorial_polarity.
// "cooling/easing/weakening" describe the *quality* of the value; whether that
// implies value up or down depends on what "good" means for the signal.
const STATUS_QUALITATIVE = {
  cooling: "toward_good", easing: "toward_good", weakening: "toward_bad",
  softening: "toward_bad", tight: "extreme_low", tightening: "toward_bad",
  weak: "extreme_low", strong: "extreme_high", improving: "toward_good"
};

function statusToExpectedDirection(statusRaw, polarity) {
  const status = String(statusRaw || "").toLowerCase().trim().split(/\s+/)[0];
  if (!status) return null;
  if (status in STATUS_WORD_DIRECTION) return STATUS_WORD_DIRECTION[status];
  if (status in STATUS_QUALITATIVE) {
    const q = STATUS_QUALITATIVE[status];
    // Resolve qualitative descriptor to value-direction via polarity.
    if (polarity === "value_down_is_positive") {
      if (q === "toward_good") return "down";   // "easing" cost -> value down
      if (q === "toward_bad") return "up";
    } else if (polarity === "value_up_is_negative") {
      if (q === "toward_good") return "down";   // "cooling" inflation -> value down
      if (q === "toward_bad") return "up";
    } else if (polarity === "value_up_is_positive") {
      if (q === "toward_good") return "up";
      if (q === "toward_bad" || q === "extreme_low") return "down";
      if (q === "extreme_high") return "up";
    }
    return null; // ambiguous -> don't force a direction
  }
  return null;
}

function checkEditorialAlignment(registry, signal, entry) {
  entry = entry || getRegistryEntry(registry, signal.id);
  const result = {
    signal_id: signal.id,
    alignment_status: "unknown",
    review_required: false,
    data_direction: null,
    editorial_stance: signal.status || null,
    expected_direction: null,
    detail: ""
  };
  if (!entry) return result;

  const polarity = (entry.alignment && entry.alignment.editorial_polarity) || "neutral";
  const vtype = (entry.validation && entry.validation.value_type) || "mixed";

  // Categorical / pattern signals: no numeric direction to contradict.
  if (vtype === "categorical") {
    result.alignment_status = "unknown";
    result.detail = "Categorical signal — no numeric direction to verify against";
    return result;
  }

  const expected = statusToExpectedDirection(signal.status, polarity);
  result.expected_direction = expected;
  if (!expected || expected === "flat") {
    result.alignment_status = "aligned";
    result.detail = expected === "flat"
      ? "Neutral status (" + signal.status + ") — cannot contradict data"
      : "Status (" + signal.status + ") has no fixed direction";
    return result;
  }

  const dataDir = computeDataDirection(signal, entry);
  result.data_direction = dataDir;
  if (!dataDir || dataDir === "flat") {
    result.alignment_status = "aligned";
    result.detail = "Data direction " + (dataDir || "unavailable") + "; stance not contradicted";
    return result;
  }

  if (expected === dataDir) {
    result.alignment_status = "aligned";
    result.detail = "Status '" + signal.status + "' (expect value " + expected +
      ") matches data direction " + dataDir;
  } else {
    result.alignment_status = "mismatch";
    result.review_required = true;
    result.detail = "Status '" + signal.status + "' implies value " + expected +
      " but data direction is " + dataDir;
  }
  return result;
}

// Numeric direction of the underlying value over recent observations.
function computeDataDirection(signal, entry) {
  // Prefer compared_to vs_12mo when available and unambiguous.
  const cmp = signal.compared_to && signal.compared_to.vs_12mo;
  if (cmp && (cmp.direction === "up" || cmp.direction === "down")) {
    // confirm against recent data_points if present
    const dp = computeFromDataPoints(signal);
    if (dp && dp !== "flat" && dp !== cmp.direction) {
      // conflict between long and short term — fall back to recent points
      return dp;
    }
    return cmp.direction;
  }
  return computeFromDataPoints(signal);
}

function computeFromDataPoints(signal) {
  const pts = (signal.data_points || []).filter((p) => p && typeof p.value === "number");
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1].value;
  const prevWindow = pts.slice(Math.max(0, pts.length - 4), pts.length - 1);
  const avgPrev = prevWindow.reduce((a, p) => a + p.value, 0) / prevWindow.length;
  const diff = last - avgPrev;
  const scale = Math.max(1e-9, Math.abs(avgPrev));
  const rel = diff / scale;
  if (Math.abs(rel) < 0.02 && Math.abs(diff) < 0.1) return "flat";
  return diff > 0 ? "up" : "down";
}

// Look at the status word + summary, map to an implied value-direction.
function inferEditorialStance(signal, registry) {
  const vocab = registry.stance_vocabulary || {};
  const hay = [signal.status, signal.momentum_label, signal.summary,
               signal.refined_why && signal.refined_why.evidence]
    .filter(Boolean).join(" ").toLowerCase();

  let label = signal.status || "";
  let implied = null;

  // Direct multi-word checks first
  const phrases = Object.keys(vocab).sort((a, b) => b.length - a.length);
  for (const ph of phrases) {
    const word = ph.replace(/_.*$/, ""); // strip disambiguation suffix like improving_up
    const re = new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
    if (re.test(hay)) {
      implied = vocab[ph];
      label = word;
      break;
    }
  }
  return { label, implied_direction: implied };
}

/* ---------- editorial freshness ---------- */
function editorialFreshness(lastReviewedISO, expiresAfterDays, now) {
  now = now ? new Date(now) : new Date();
  if (!lastReviewedISO) return { editorial_status: "stale", age_days: null, detail: "no review date" };
  const d = toComparableDate(lastReviewedISO);
  if (!d) return { editorial_status: "stale", age_days: null, detail: "invalid review date" };
  const age = daysBetween(now, d);
  const exp = expiresAfterDays != null ? expiresAfterDays : 35;
  let status;
  if (age <= Math.floor(exp * 0.7)) status = "current";
  else if (age <= exp) status = "aging";
  else status = "stale";
  return { editorial_status: status, age_days: age, expires_after_days: exp };
}

/* ---------- cross-signal narrative alignment (Pass F) ---------- */
/*
  Pass D's checkEditorialAlignment is PER-SIGNAL: does one signal's status word
  match its own data direction? Pass F adds a CROSS-SIGNAL check: does the
  Weekly Connection's narrative ("things are slowing") agree with the aggregate
  direction of the published signals?

  Approach (deliberately conservative — flag only, never auto-rewrite):
    1. Scan the Weekly Connection prose for direction words and pick the
       dominant narrative direction (up / down) by frequency.
    2. Count published CONTENT signals by their authoritative data direction
       (compared_to.vs_12mo.direction), interpreted as up/down via the same
       recognized direction vocabulary. A signal is only "usable" when that
       direction maps to a recognized word — pending_automation registry stubs
       (which never appear in content) and signals with missing / null /
       unrecognized direction are skipped and counted as skipped.
    3. Minimum-count guard: if fewer than MIN_USABLE_NARRATIVE_SIGNALS signals
       have a usable direction, do NOT flag a mismatch (too little signal to
       judge the narrative against).
    4. Mismatch when the narrative's dominant direction is clear AND more than
       NARRATIVE_MISMATCH_FRACTION of usable signals move the OPPOSITE way.

  Returns a plain object; the validator decides what to write.
*/

// Narrative direction vocabulary. Maps the prose/data direction words listed in
// the Pass F brief to a coarse value-direction. "up" = expanding / accelerating
// / heating; "down" = slowing / cooling / softening / contracting. This is the
// recognized-word set referenced by clarification #4; it is intentionally a
// superset-compatible companion to STATUS_WORD_DIRECTION (same up/down spirit).
const NARRATIVE_DIRECTION_WORDS = {
  // upward / strengthening
  improving: "up", strengthening: "up", reaccelerating: "up",
  accelerating: "up", expanding: "up", rising: "up", climbing: "up",
  heating: "up", surging: "up", growing: "up",
  // downward / weakening
  slowing: "down", cooling: "down", softening: "down", weakening: "down",
  contracting: "down", easing: "down", tightening: "down", falling: "down",
  declining: "down", dropping: "down"
};

const MIN_USABLE_NARRATIVE_SIGNALS = 4;
const NARRATIVE_MISMATCH_FRACTION = 0.6;

// Map a signal's authoritative data direction to up/down using the recognized
// vocabulary. The direction field carries "up"/"down"/"flat" already; we accept
// the literal up/down and treat anything else (flat, null, missing) as unusable.
function usableDataDirection(signal) {
  const cmp = signal && signal.compared_to && signal.compared_to.vs_12mo;
  const dir = cmp && cmp.direction;
  if (dir === "up" || dir === "down") return dir;
  return null;
}

// Scan free text for recognized direction words; return counts + dominant.
function scanNarrativeDirection(text) {
  const counts = { up: 0, down: 0 };
  const hits = [];
  const hay = String(text || "").toLowerCase();
  for (const word of Object.keys(NARRATIVE_DIRECTION_WORDS)) {
    const re = new RegExp("\\b" + word + "\\b", "g");
    const m = hay.match(re);
    if (m && m.length) {
      counts[NARRATIVE_DIRECTION_WORDS[word]] += m.length;
      hits.push({ word, dir: NARRATIVE_DIRECTION_WORDS[word], n: m.length });
    }
  }
  let dominant = null;
  if (counts.up > counts.down) dominant = "up";
  else if (counts.down > counts.up) dominant = "down";
  return { counts, hits, dominant };
}

// Gather the Weekly Connection narrative prose from its various fields.
function weeklyConnectionNarrativeText(weeklyConnection) {
  if (!weeklyConnection) return "";
  const r = weeklyConnection.refined || {};
  const parts = [
    weeklyConnection.title,
    weeklyConnection.subtitle,
    r.observation, r.why_it_matters, r.decision_this_week, r.pm_implication_default,
    ...(Array.isArray(weeklyConnection.body_paragraphs) ? weeklyConnection.body_paragraphs : [])
  ];
  return parts.filter(Boolean).join(" ");
}

function checkNarrativeAlignment(weeklyConnection, signals, registry) {
  const result = {
    narrative_review_required: false,
    dominant_direction_in_narrative: null,
    narrative_direction_counts: { up: 0, down: 0 },
    signals_moving_with_narrative: [],
    signals_moving_against_narrative: [],
    usable_count: 0,
    skipped_count: 0,
    minimum_count: MIN_USABLE_NARRATIVE_SIGNALS,
    minimum_count_met: false,
    mismatch_fraction_threshold: NARRATIVE_MISMATCH_FRACTION,
    against_fraction: 0,
    review_note: ""
  };

  const text = weeklyConnectionNarrativeText(weeklyConnection);
  const scan = scanNarrativeDirection(text);
  result.dominant_direction_in_narrative = scan.dominant;
  result.narrative_direction_counts = scan.counts;

  const content = Array.isArray(signals) ? signals : [];
  const withDir = [];
  const againstDir = [];
  let usable = 0;
  let skipped = 0;

  for (const s of content) {
    // Skip registry-only pending_automation stubs defensively (they should not
    // appear in content at all, but never count them if they somehow do).
    const entry = registry ? getRegistryEntry(registry, s.id) : null;
    if (entry && entry.status_type === "pending_automation") { skipped++; continue; }
    const dir = usableDataDirection(s);
    if (!dir) { skipped++; continue; }
    usable++;
    if (scan.dominant) {
      if (dir === scan.dominant) withDir.push(s.id);
      else againstDir.push(s.id);
    }
  }

  result.usable_count = usable;
  result.skipped_count = skipped;
  result.minimum_count_met = usable >= MIN_USABLE_NARRATIVE_SIGNALS;
  result.signals_moving_with_narrative = withDir;
  result.signals_moving_against_narrative = againstDir;

  // No clear narrative direction => nothing to contradict.
  if (!scan.dominant) {
    result.review_note = "No dominant direction word found in the Weekly Connection narrative; nothing to contradict.";
    return result;
  }
  // Too few usable signals => do not flag (minimum-count guard).
  if (!result.minimum_count_met) {
    result.review_note = "Only " + usable + " signal(s) have a usable direction (minimum " +
      MIN_USABLE_NARRATIVE_SIGNALS + "); narrative mismatch not evaluated.";
    return result;
  }

  const against = againstDir.length;
  const fraction = usable > 0 ? against / usable : 0;
  result.against_fraction = Math.round(fraction * 1000) / 1000;

  if (fraction > NARRATIVE_MISMATCH_FRACTION) {
    result.narrative_review_required = true;
    result.review_note = "Weekly Connection narrative reads '" + scan.dominant +
      "' but " + against + " of " + usable + " directional signals (" +
      Math.round(fraction * 100) + "%) are moving the opposite way: " +
      againstDir.join(", ") + ".";
  } else {
    result.review_note = "Narrative direction '" + scan.dominant + "' is consistent with " +
      withDir.length + " of " + usable + " directional signals (" +
      against + " against, below the " + Math.round(NARRATIVE_MISMATCH_FRACTION * 100) + "% threshold).";
  }
  return result;
}

// Front-end / validator helper: should the Weekly Connection's interpretive
// prose fall back to neutral copy? True when the narrative was flagged for
// review OR any connected signal is in alignment mismatch. Strictly defensive:
// missing fields => false.
function weeklyConnectionNeedsReview(weeklyConnection, signals) {
  if (!weeklyConnection) return false;
  if (weeklyConnection.narrative_review_required === true) return true;
  if (weeklyConnection.review_required === true) return true;
  const connected = weeklyConnection.connected_signals || [];
  const content = Array.isArray(signals) ? signals : [];
  return connected.some((id) => {
    const s = content.find((x) => x && x.id === id);
    return s && s.alignment_status === "mismatch";
  });
}

/* ---------- last-known-good protection ---------- */
/*
  Given the previous trusted signal object and a validation verdict, decide
  what to write. Never overwrites trusted value on failed/needs_review.
*/
function applyVerdict(prevSignal, candidate, verdict, now) {
  now = now ? new Date(now) : new Date();
  const out = Object.assign({}, prevSignal);
  const trust = {
    status: verdict.status,
    checked_at: now.toISOString(),
    reason: verdict.reason
  };

  if (verdict.status === "verified" || verdict.status === "manual") {
    // accept candidate
    if (candidate.value != null) out.current_value = candidate.value;
    if (candidate.date != null) out.last_updated = candidate.date;
    if (candidate.unit != null) out.current_unit = candidate.unit;
    trust.last_known_good_value = out.current_value;
    trust.last_known_good_date = out.last_updated;
    trust.applied = true;
  } else if (verdict.status === "stale") {
    // accept value but flag stale
    if (candidate.value != null) out.current_value = candidate.value;
    if (candidate.date != null) out.last_updated = candidate.date;
    trust.last_known_good_value = out.current_value;
    trust.last_known_good_date = out.last_updated;
    trust.applied = true;
  } else {
    // failed or needs_review -> PRESERVE last-known-good, record failure
    trust.applied = false;
    trust.last_known_good_value = prevSignal.current_value;
    trust.last_known_good_date = prevSignal.last_updated;
    trust.rejected_candidate = {
      value: candidate.value != null ? candidate.value : null,
      date: candidate.date != null ? candidate.date : null
    };
    trust.failure_reason = verdict.reason;
    trust.failure_at = now.toISOString();
  }

  out.trust = trust;
  return out;
}

module.exports = {
  parseLooseNumber,
  isValidISODate,
  toComparableDate,
  daysBetween,
  getRegistryEntry,
  validateSignalUpdate,
  checkEditorialAlignment,
  computeDataDirection,
  inferEditorialStance,
  editorialFreshness,
  checkNarrativeAlignment,
  weeklyConnectionNeedsReview,
  applyVerdict,
  STATUS_WORD_DIRECTION,
  NARRATIVE_DIRECTION_WORDS,
  MIN_USABLE_NARRATIVE_SIGNALS,
  NARRATIVE_MISMATCH_FRACTION
};
