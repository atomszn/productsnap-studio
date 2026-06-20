#!/usr/bin/env node
/* =============================================================================
   test-post-publish-check.js — live-verification (auto-revert detector) regression
   -----------------------------------------------------------------------------
   Dependency-free (Node built-ins only). No network: the HTTP fetch and the sleep
   are INJECTED, so the suite runs instantly and offline.

   Asserts the detector under the auto-revert cron:
     · A live body whose editorial fingerprint MATCHES the just-published content
       -> ok=true, reason "match", matched=true (cron does nothing).
     · A live body that is STALE (old editorial content) -> ok=false,
       reason "stale_content" (cron reverts).
     · HTTP 500 -> ok=false, reason "http_status_500".
     · Unparseable body -> ok=false, reason "invalid_json".
     · A thrown fetch (network down) -> ok=false, reason starts "fetch_error".
     · Retries: verifyLive retries on transient failure and SUCCEEDS once the live
       body catches up (simulating Pages finishing its rebuild), reporting the
       attempt count.
     · Retries exhaust to the last failure when the body never catches up.
     · The fingerprint ignores DATA fields (current_value) and changes when the
       EDITORIAL surface (summary/status/prose) changes — so it proves new
       editorial content shipped, not a data refresh.
   ===========================================================================*/
"use strict";

const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const pp = require(path.join(ROOT, "scripts", "lib", "post-publish-check.js"));

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  ok  - " + name); }
  else { console.log("  FAIL- " + name + (detail ? " — " + detail : "")); failures++; }
}

console.log("test-post-publish-check");

// The content we "just published".
const EXPECTED = {
  weekly_connection: {
    title: "Prices cooled a touch",
    subtitle: "A calmer month",
    date: "2026-06-20",
    refined: { one_liner: "Calmer." },
    body_paragraphs: ["Things eased."]
  },
  signals: [
    { id: "cpi", title: "Inflation", summary: "Prices rose 0.3% last month.", status: "rising",
      current_value: "3.1%", last_editorial_reviewed: "2026-06-20" }
  ]
};

const noSleep = () => Promise.resolve();
function jsonResponse(status, obj) {
  return { status: status, ok: status >= 200 && status < 300, text: () => Promise.resolve(JSON.stringify(obj)) };
}
function rawResponse(status, text) {
  return { status: status, ok: status >= 200 && status < 300, text: () => Promise.resolve(text) };
}

/* ---- fingerprint behaviour: editorial-sensitive, data-insensitive ---- */
(function () {
  const fpBase = pp.editorialFingerprint(EXPECTED);
  // Change a DATA-only field -> fingerprint must NOT move.
  const dataChanged = JSON.parse(JSON.stringify(EXPECTED));
  dataChanged.signals[0].current_value = "9.9%";
  ok("fingerprint ignores data (current_value)", pp.editorialFingerprint(dataChanged) === fpBase);
  // Change EDITORIAL prose -> fingerprint MUST move.
  const proseChanged = JSON.parse(JSON.stringify(EXPECTED));
  proseChanged.signals[0].summary = "Prices fell sharply.";
  ok("fingerprint changes when editorial prose changes", pp.editorialFingerprint(proseChanged) !== fpBase);
})();

/* ---- single-attempt verifyOnce reasons ---- */
(async function () {
  const fp = pp.editorialFingerprint(EXPECTED);

  let r = await pp.verifyOnce(fp, "u", () => Promise.resolve(jsonResponse(200, EXPECTED)));
  ok("match -> ok + reason 'match'", r.ok === true && r.reason === "match" && r.matched === true, JSON.stringify(r));

  const stale = JSON.parse(JSON.stringify(EXPECTED));
  stale.signals[0].summary = "An entirely different older summary.";
  r = await pp.verifyOnce(fp, "u", () => Promise.resolve(jsonResponse(200, stale)));
  ok("stale body -> not ok + reason 'stale_content'", r.ok === false && r.reason === "stale_content", JSON.stringify(r));

  r = await pp.verifyOnce(fp, "u", () => Promise.resolve(jsonResponse(500, EXPECTED)));
  ok("HTTP 500 -> reason 'http_status_500'", r.ok === false && r.reason === "http_status_500" && r.http_status === 500, JSON.stringify(r));

  r = await pp.verifyOnce(fp, "u", () => Promise.resolve(rawResponse(200, "<<not json>>")));
  ok("bad JSON -> reason 'invalid_json'", r.ok === false && r.reason === "invalid_json", JSON.stringify(r));

  r = await pp.verifyOnce(fp, "u", () => Promise.reject(new Error("ECONNREFUSED")));
  ok("thrown fetch -> reason starts 'fetch_error'", r.ok === false && /^fetch_error/.test(r.reason), JSON.stringify(r));

  /* ---- verifyLive: success on first attempt ---- */
  let rl = await pp.verifyLive(EXPECTED, {
    fetchImpl: () => Promise.resolve(jsonResponse(200, EXPECTED)),
    sleepImpl: noSleep, retries: 5, backoffMs: 1
  });
  ok("verifyLive match first try -> ok, attempts=1", rl.ok === true && rl.attempts === 1, JSON.stringify(rl));

  /* ---- verifyLive: retries until the live body catches up ---- */
  let calls = 0;
  rl = await pp.verifyLive(EXPECTED, {
    fetchImpl: () => {
      calls++;
      // First two fetches serve STALE content (Pages still rebuilding), then fresh.
      if (calls < 3) {
        const stale2 = JSON.parse(JSON.stringify(EXPECTED));
        stale2.signals[0].summary = "stale cache " + calls;
        return Promise.resolve(jsonResponse(200, stale2));
      }
      return Promise.resolve(jsonResponse(200, EXPECTED));
    },
    sleepImpl: noSleep, retries: 5, backoffMs: 1
  });
  ok("verifyLive retries then succeeds -> ok, attempts=3", rl.ok === true && rl.attempts === 3, JSON.stringify(rl));

  /* ---- verifyLive: never catches up -> exhausts to last failure ---- */
  rl = await pp.verifyLive(EXPECTED, {
    fetchImpl: () => {
      const stale3 = JSON.parse(JSON.stringify(EXPECTED));
      stale3.signals[0].summary = "perpetually stale";
      return Promise.resolve(jsonResponse(200, stale3));
    },
    sleepImpl: noSleep, retries: 2, backoffMs: 1
  });
  ok("verifyLive never matches -> not ok after retries+1 attempts",
    rl.ok === false && rl.reason === "stale_content" && rl.attempts === 3, JSON.stringify(rl));

  /* ---- verifyLive: missing expected content -> no fingerprint ---- */
  rl = await pp.verifyLive(null, { fetchImpl: () => Promise.resolve(jsonResponse(200, EXPECTED)), sleepImpl: noSleep });
  ok("verifyLive with no expected content -> reason 'no_expected_fingerprint'",
    rl.ok === false && rl.reason === "no_expected_fingerprint", JSON.stringify(rl));

  if (failures > 0) { console.error("\ntest-post-publish-check: " + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\ntest-post-publish-check: all checks passed");
  process.exit(0);
})();
