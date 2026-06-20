#!/usr/bin/env node
/* =============================================================================
   test-no-advice-scan.js — deterministic advice/prediction backstop regression
   -----------------------------------------------------------------------------
   Dependency-free (Node built-ins only). No AI, no network, no live-file writes.

   Asserts the multi-fold floor under the AI panel:
     · PRESCRIPTIVE advice ("you should buy", "buy the dip", "time to invest")
       is flagged (pass=false).
     · PREDICTIVE forward claims ("rates will be cut next month", "X will hit $N")
       are flagged.
     · Legitimate PAST/REPORTED macro description ("prices rose 0.3% last month",
       "the gauge came in at 49.8") is NOT flagged (no false positives).
     · An ATTRIBUTED third-party prediction ("analysts expect rates to fall") is
       allowed (we are reporting, not predicting) — but attributed ADVICE is not.
     · Machine fields (signals_used, current_value, links) are NEVER scanned, so a
       jargon/number-looking token there can't produce an advice hit.
   ===========================================================================*/
"use strict";

const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const na = require(path.join(ROOT, "scripts", "lib", "no-advice-scan.js"));

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  ok  - " + name); }
  else { console.log("  FAIL- " + name + (detail ? " — " + detail : "")); failures++; }
}
function scan(prose) { return na.scanNoAdvice({ signals: [{ id: "x", summary: prose }] }); }

console.log("test-no-advice-scan");

/* ---------------- prescriptive advice is flagged ---------------- */
ok("'you should buy' is flagged", scan("If you ask us, you should buy the stock now.").pass === false);
ok("'buy the dip' is flagged", scan("This looks like a great moment to buy the dip.").pass === false);
ok("'time to invest' is flagged", scan("Now is a good time to invest in this sector.").pass === false);
ok("'we recommend buying' is flagged", scan("We recommend buying ahead of the print.").pass === false);
ok("'put your money in' is flagged", scan("You could put your money into bonds here.").pass === false);
ok("'your portfolio' is flagged", scan("This should reshape your portfolio decisions.").pass === false);
ok("'guaranteed returns' is flagged", scan("It promises guaranteed returns over a year.").pass === false);

/* ---------------- predictive forward claims are flagged ---------------- */
ok("'rates will be cut next month' is flagged", scan("In our view, rates will be cut next month.").pass === false);
ok("'prices will rise' is flagged", scan("Prices will rise sharply from here.").pass === false);
ok("'will hit $N' is flagged", scan("The index will hit $5000 by year end.").pass === false);
ok("'expect inflation to fall' (unattributed) is flagged", scan("We expect inflation to fall fast.").pass === false);

/* ---------------- legitimate PAST/REPORTED description passes ---------------- */
ok("'prices rose 0.3% last month' passes", scan("Prices rose 0.3% last month, a mild move.").pass === true,
  JSON.stringify(scan("Prices rose 0.3% last month, a mild move.").hits));
ok("'came in at 49.8' passes", scan("The factory gauge came in at 49.8 this month.").pass === true);
ok("'jobs fell while wages climbed' (past) passes", scan("Jobs fell while wages climbed over the year.").pass === true);
ok("'inflation cooled year over year' (past) passes", scan("Inflation cooled compared with a year ago.").pass === true);
ok("plain business 'sell into manufacturers' passes", scan("Vendors sell into manufacturers at lower prices.").pass === true);

/* ---------------- attributed third-party prediction is allowed ---------------- */
ok("'analysts expect rates to fall' (attributed) passes",
  scan("Analysts expect rates to fall later this year.").pass === true,
  JSON.stringify(scan("Analysts expect rates to fall later this year.").hits));
ok("'the market is pricing in a cut' (attributed) passes",
  scan("The market is pricing in a cut next quarter.").pass === true);

/* ---------------- machine fields are never scanned ---------------- */
(function () {
  const page = {
    signals: [{
      id: "x",
      summary: "Prices rose a little last month.",         // clean prose
      current_value: "buy the dip",                         // machine field — must be ignored
      sources: [{ name: "you should buy", url: "https://x" }], // skipped
      why_we_think_this: { signals_used: ["time to invest", "buy the dip"] } // machine list
    }]
  };
  const r = na.scanNoAdvice(page);
  ok("advice-looking tokens in machine fields are NOT scanned (pass=true)", r.pass === true,
    JSON.stringify(r.hits));
})();

/* ---------------- hit shape carries path + sentence ---------------- */
(function () {
  const r = na.scanNoAdvice({ weekly_connection: { title: "You should sell the stock today." } });
  ok("hit includes the offending sentence", r.hits.length > 0 && /should sell the stock/i.test(r.hits[0].sentence));
  ok("hit includes a JSON path", r.hits.length > 0 && r.hits[0].path.indexOf("weekly_connection.title") !== -1);
})();

if (failures > 0) { console.error("\ntest-no-advice-scan: " + failures + " FAILURE(S)"); process.exit(1); }
console.log("\ntest-no-advice-scan: all checks passed");
process.exit(0);
