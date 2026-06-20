"use strict";
/* =============================================================================
   no-advice-scan.js — deterministic phrase-level investment-advice / market-
   prediction backstop                                              (Phase 3)
   -----------------------------------------------------------------------------
   Dependency-free (Node standard library + clarity-scan's prose-walk only). Pure
   functions: no network, no process.exit, no file writes.

   This is a DETERMINISTIC FLOOR under the AI panel. verify-claims.js already does
   a coarse advice scan over the DRAFT's prose; this scanner is the whole-page
   backstop run over the APPLIED tree at gate time, so a generous AI judge can
   never let prescriptive ("you should buy") or predictive ("rates will be cut
   next month") language through. Any hit is a HARD block.

   The hard problem is precision: a macro page is FULL of legitimate past/reported
   movement language ("prices rose 0.3% last month", "the index came in at 49.8")
   that must NOT trip the gate. We flag only PRESCRIPTIVE (advice) and PREDICTIVE
   (forward-looking) framing, and we explicitly distinguish PAST/REPORTED verbs
   ("rose", "fell", "came in at") from PREDICTIVE ("will rise", "expect it to").

   It walks the SAME editable prose set as clarity-scan (reusing extractPageProse),
   so machine fields (signals_used, current_value, links, sources, status enums,
   ids, dates) are never scanned — they cannot produce a false advice hit.

   Returns a plain object the runner folds into the quality report. The runner
   (not this module) decides how it affects the verdict / publish bar.
   ===========================================================================*/

const { extractPageProse, splitSentences } = require("./clarity-scan");

/* ---------- curated advice / prediction phrase list ----------
   Each entry: { id, re, kind } where kind is "prescriptive" (telling the reader
   to act) or "predictive" (a forward-looking claim about a future price/level).
   Patterns are deliberately precise. We require an INVESTMENT OBJECT or an
   explicit FORWARD-LOOKING construction so plain business prose ("buy software",
   "sell into manufacturers", "prices rose last month") never trips.

   Precision rules baked in:
     · PAST / REPORTED is FINE: "rose", "fell", "climbed", "came in at",
       "ticked up", "edged down", "last month", "year over year". None of these
       appear as triggers; only the FUTURE-tense / imperative forms do.
     · PREDICTIVE requires a future construction: "will <move>", "going to
       <move>", "expect(ed) to <move>", "is set to", "is poised to", "by <year>
       <subject> will", "next month/quarter/year ... will".
     · PRESCRIPTIVE requires an action verb aimed at the reader/portfolio or a
       market object: "you should buy/sell/invest", "we recommend buying", "buy
       the dip", "time to invest", "put your money in".
*/
const ADVICE_PATTERNS = [
  /* ----- prescriptive: direct recommendations to the reader ----- */
  { id: "you-should-act", kind: "prescriptive",
    re: /\byou\s+(?:should|ought to|need to|must|may want to|might want to)\s+(?:buy|sell|short|invest|trade|hold|dump|load up|get out)\b/i },
  { id: "we-recommend", kind: "prescriptive",
    re: /\bwe\s+(?:recommend|advise|suggest|urge)\s+(?:buying|selling|shorting|investing|holding|that you|you)\b/i },
  { id: "recommend-buy-sell", kind: "prescriptive",
    re: /\b(?:recommend|advise|suggest|urge)\s+(?:buying|selling|shorting)\b/i },
  { id: "buy-the-dip", kind: "prescriptive", re: /\bbuy\s+the\s+dip\b/i },
  { id: "time-to-invest", kind: "prescriptive",
    re: /\b(?:now is|it'?s|this is)\s+(?:a\s+(?:good|great)\s+)?time\s+to\s+(?:buy|sell|invest|get in|get out)\b/i },
  { id: "time-to-buy", kind: "prescriptive", re: /\btime\s+to\s+(?:buy|sell|invest)\b/i },
  { id: "put-money-in", kind: "prescriptive",
    re: /\bput\s+your\s+money\s+(?:in|into)\b/i },
  { id: "load-up", kind: "prescriptive",
    re: /\bload\s+up\s+on\b/i },
  { id: "buy-sell-object", kind: "prescriptive",
    re: /\b(?:buy|sell|short|trade)\s+(?:the\s+)?(?:stock|stocks|shares|equit(?:y|ies)|the\s+dip|the\s+market|bonds|crypto|bitcoin|gold)\b/i },
  { id: "portfolio-action", kind: "prescriptive",
    re: /\b(?:add to|trim|rotate (?:in)?to|overweight|underweight)\s+(?:your\s+)?(?:portfolio|position|holdings|exposure)\b/i },
  { id: "your-portfolio", kind: "prescriptive", re: /\b(?:your|their)\s+portfolio\b/i },
  { id: "guaranteed-return", kind: "prescriptive",
    re: /\bguaranteed\s+(?:returns?|profit|gains?|money)\b/i },
  { id: "price-target", kind: "predictive", re: /\bprice\s+targets?\b/i },

  /* ----- predictive: forward-looking claims about future price/level ----- */
  // "<market subject> will <move>" — requires a future verb, so past tense
  // ("prices rose") is untouched. Market/economic subjects only.
  { id: "subject-will-move", kind: "predictive",
    re: /\b(?:stocks?|shares?|the\s+market|the\s+index|prices?|inflation|rates?|the\s+(?:fed|economy)|gdp|cpi|unemployment|yields?|the\s+dollar|bitcoin|crypto|gold|oil|this\s+(?:stock|asset|sector))\s+(?:will|won'?t|is\s+going\s+to|are\s+going\s+to|is\s+likely\s+to|are\s+likely\s+to|should|could|may|might)\s+(?:rise|fall|drop|surge|plunge|climb|crash|hit|reach|jump|spike|tank|rally|soar|sink|cool|cut|be\s+cut|rebound|recover|decline|increase|decrease|go\s+up|go\s+down)\b/i },
  // "X will hit/reach $N" forward price prediction
  { id: "will-hit-level", kind: "predictive",
    re: /\bwill\s+(?:hit|reach|top|breach|fall\s+to|drop\s+to|rise\s+to|climb\s+to)\s+\$?\d/i },
  // "expect(ed) ... to <move>"
  { id: "expect-to-move", kind: "predictive",
    re: /\bexpect(?:ed|s|ing)?\s+(?:it|them|prices?|rates?|inflation|the\s+\w+|markets?|stocks?)\s+to\s+(?:rise|fall|drop|surge|plunge|climb|crash|hit|reach|jump|cut|be\s+cut|cool|rebound|recover|decline)\b/i },
  // "is/are set to / poised to <move>"
  { id: "set-to-move", kind: "predictive",
    re: /\b(?:is|are|seems?\s+(?:set|poised)|looks?\s+(?:set|poised))\s+(?:set|poised|likely)\s+to\s+(?:rise|fall|drop|surge|plunge|climb|crash|hit|reach|jump|cut|be\s+cut|cool|rebound|recover|decline)\b/i },
  // "rates will be cut next month/quarter" / "next <period> ... will"
  { id: "next-period-will", kind: "predictive",
    re: /\b(?:next|this\s+coming|the\s+coming)\s+(?:month|quarter|year|week)\b[^.?!]*\b(?:will|is\s+going\s+to|are\s+going\s+to|expect|likely)\b/i },
  // "by <year>, <subject> will" forward construction
  { id: "by-year-will", kind: "predictive",
    re: /\bby\s+(?:20\d\d|next\s+(?:year|month|quarter)|year[- ]end|the\s+end\s+of\s+the\s+year)\b[^.?!]*\b(?:will|should\s+(?:rise|fall|hit|reach)|is\s+going\s+to)\b/i }
];

/* ---------- prediction guard: don't flag REPORTED predictions ----------
   "Analysts expect rates to fall" / "the survey forecasts a cut" is REPORTING a
   third party's prediction, not US predicting. We allow an explicitly-attributed
   forward statement (attribution cue near the start of the sentence) to pass for
   the PREDICTIVE family ONLY. Prescriptive advice is never excused by attribution
   ("analysts say you should buy" is still advice on our page). */
const ATTRIBUTION_CUE = /\b(?:analysts?|economists?|the\s+(?:fed|market|survey|consensus|street)|forecasters?|traders?|investors?|markets?|futures?|the\s+\w+\s+(?:survey|index|poll))\s+(?:expect|expects|anticipate|anticipates|forecast|forecasts|predict|predicts|price\s+in|are\s+pricing|see|sees|project|projects|bet|believe)\b/i;

function scanSentence(sentence) {
  const hits = [];
  for (const p of ADVICE_PATTERNS) {
    const m = sentence.match(p.re);
    if (!m) continue;
    // Predictive hits that are clearly ATTRIBUTED to a third party are reporting,
    // not our prediction — allow them. Prescriptive hits are never excused.
    if (p.kind === "predictive" && ATTRIBUTION_CUE.test(sentence)) continue;
    hits.push({ term: m[0].trim().toLowerCase(), pattern: p.id, kind: p.kind });
  }
  return hits;
}

/* ---------- main entry ----------
   scanNoAdvice(content, opts)
     content — the APPLIED content tree (post-apply, pre-publish) OR live content.
     opts    — reserved for future use (e.g. { gateScope }).

   Returns:
     {
       pass,                 // true when no hit anywhere
       hits: [{ term, path, sentence, pattern, kind }],
       sections_scanned      // count of prose strings walked
     }
*/
function scanNoAdvice(content, opts) {
  opts = opts || {};
  const prose = extractPageProse(content);
  const hits = [];
  for (const { path: p, text } of prose) {
    for (const sentence of splitSentences(text)) {
      const sHits = scanSentence(sentence);
      for (const h of sHits) {
        hits.push({ term: h.term, path: p, sentence: sentence.trim(), pattern: h.pattern, kind: h.kind });
      }
    }
  }
  return {
    pass: hits.length === 0,
    hits,
    sections_scanned: prose.length
  };
}

module.exports = {
  scanNoAdvice,
  scanSentence,
  ADVICE_PATTERNS,
  ATTRIBUTION_CUE
};
