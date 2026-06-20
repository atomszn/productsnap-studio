"use strict";
/* =============================================================================
   post-publish-check.js — verify the LIVE site actually serves the new content
   after an auto-publish, so a failed deploy can be auto-reverted   (Phase 3)
   -----------------------------------------------------------------------------
   Dependency-free (Node standard library only). The actual network fetch is
   INJECTABLE (opts.fetchImpl) so this module is fully testable WITHOUT a network.

   After an auto-publish commits to main and GitHub Pages rebuilds, the cron calls
   the runner's --post-publish-verify, which calls verifyLive() here. This module
   ONLY DETECTS — it never pushes, never reverts. It returns a clean result + the
   runner maps it to an exit code (0 = live matches, 6 = live does NOT match after
   retries). The CRON does the git revert + notify on a nonzero exit.

   verifyLive confirms three things about the live JSON:
     (a) HTTP 200,
     (b) the body parses as valid JSON,
     (c) a FINGERPRINT derived from the expected (just-published) editorial fields
         is present in the live content — i.e. the new content really shipped, not
         a stale cache of the old page.

   Because Pages can take 1–3 minutes to rebuild, verifyLive supports retries with
   linear backoff before declaring failure. Sleep is injectable too (opts.sleepImpl)
   so tests run instantly.
   ===========================================================================*/

const crypto = require("crypto");

const DEFAULT_URL = "https://productsnap.studio/data/pulse-content.json";

// A stable fingerprint of the EDITORIAL surface we just published. We hash the
// fields the editor can change (weekly_connection prose + each signal's editorial
// prose + editorial dates), NOT the data values — so the marker proves the new
// EDITORIAL content is live, which is exactly what an auto-publish changes. Stable
// key ordering via a recursive canonical stringify so the hash is deterministic.
function editorialFingerprint(content) {
  if (!content || typeof content !== "object") return null;
  const wc = content.weekly_connection || {};
  const surface = {
    wc: {
      title: wc.title || "",
      subtitle: wc.subtitle || "",
      date: wc.date || "",
      last_editorial_reviewed: wc.last_editorial_reviewed || "",
      refined: wc.refined || {},
      body_paragraphs: wc.body_paragraphs || []
    },
    signals: ((content.signals) || []).map((s) => ({
      id: s.id,
      title: s.title || "",
      summary: s.summary || "",
      status: s.status || "",
      last_editorial_reviewed: s.last_editorial_reviewed || ""
    }))
  };
  return crypto.createHash("sha256").update(canonical(surface)).digest("hex");
}

// Deterministic JSON: object keys sorted recursively.
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}

// Node 20 has a global fetch; allow override for tests / older runtimes.
function defaultFetch(url) {
  if (typeof fetch === "function") return fetch(url);
  // Fallback to the https module if global fetch is unavailable.
  return httpsGet(url);
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    let https;
    try { https = require("https"); } catch (e) { return reject(e); }
    const req = https.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          text: () => Promise.resolve(body)
        });
      });
    });
    req.on("error", reject);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------- single attempt ----------
   Returns { ok, reason, http_status, matched }. Pure verification of one fetch.
*/
async function verifyOnce(expectedFingerprint, url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    return { ok: false, reason: "fetch_error: " + e.message, http_status: 0, matched: false };
  }
  const status = res.status != null ? res.status : (res.statusCode != null ? res.statusCode : 0);
  if (status !== 200) {
    return { ok: false, reason: "http_status_" + status, http_status: status, matched: false };
  }
  let bodyText;
  try {
    bodyText = typeof res.text === "function" ? await res.text() : String(res.body || "");
  } catch (e) {
    return { ok: false, reason: "read_error: " + e.message, http_status: status, matched: false };
  }
  let live;
  try {
    live = JSON.parse(bodyText);
  } catch (e) {
    return { ok: false, reason: "invalid_json", http_status: status, matched: false };
  }
  const liveFp = editorialFingerprint(live);
  if (liveFp && expectedFingerprint && liveFp === expectedFingerprint) {
    return { ok: true, reason: "match", http_status: status, matched: true };
  }
  return { ok: false, reason: "stale_content", http_status: status, matched: false };
}

/* ---------- main entry ----------
   verifyLive(expectedContent, opts)
     expectedContent — the applied content we just published (source of the marker).
     opts:
       url        — live URL (default https://productsnap.studio/data/pulse-content.json)
       fetchImpl  — async (url) -> { status, text() } (default global fetch / https)
       sleepImpl  — async (ms) -> void (default setTimeout; inject for instant tests)
       retries    — number of additional attempts after the first (default 5)
       backoffMs  — base backoff; attempt n waits n*backoffMs (default 30000 ~ up to 3min)

   Returns the LAST attempt's { ok, reason, http_status, matched } plus attempts.
*/
async function verifyLive(expectedContent, opts) {
  opts = opts || {};
  const url = opts.url || DEFAULT_URL;
  const fetchImpl = opts.fetchImpl || defaultFetch;
  const sleepImpl = opts.sleepImpl || sleep;
  const retries = opts.retries != null ? opts.retries : 5;
  const backoffMs = opts.backoffMs != null ? opts.backoffMs : 30000;

  const expectedFingerprint = editorialFingerprint(expectedContent);
  if (!expectedFingerprint) {
    return { ok: false, reason: "no_expected_fingerprint", http_status: 0, matched: false, attempts: 0 };
  }

  let last = { ok: false, reason: "not_attempted", http_status: 0, matched: false };
  const total = Math.max(1, retries + 1);
  for (let attempt = 1; attempt <= total; attempt++) {
    last = await verifyOnce(expectedFingerprint, url, fetchImpl);
    last.attempts = attempt;
    if (last.ok) return last;
    if (attempt < total) await sleepImpl(attempt * backoffMs);
  }
  return last;
}

module.exports = {
  verifyLive,
  verifyOnce,
  editorialFingerprint,
  canonical,
  DEFAULT_URL
};
