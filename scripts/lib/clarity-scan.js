"use strict";
/* =============================================================================
   clarity-scan.js — deterministic whole-page clarity + jargon reconciler (Phase 3)
   -----------------------------------------------------------------------------
   Dependency-free (Node standard library only). Pure functions: no network, no
   process.exit, no file writes. This is the deterministic spine of the new
   "macro-editor" clarity gate the project requires: the published Pulse page must
   read at US grade <= 9, in plain layman language, with NO unexplained economic
   jargon, top-to-bottom, section-to-section.

   It does TWO things the AI layer cannot be trusted to self-grade:

     1. JARGON  — scans EVERY prose string on the whole page for a curated list of
                  economic / technical jargon terms. A flagged term is allowed ONLY
                  if it is plainly explained nearby (an explanation cue appears in
                  the same string, e.g. a dash-gloss or "which means ..."). Any
                  unexplained jargon term is a HARD clarity failure (it blocks
                  auto-publish and the page holds for a rewrite next run).

     2. GRADE   — a deterministic readability estimate (Flesch-Kincaid grade) over
                  the whole page and the single hardest sentence. This is a coarse,
                  reproducible floor that does NOT replace the validation agent's
                  human-style grade judgement — it catches obviously-too-hard prose
                  mechanically so a generous AI grade can never sneak past.

   Unlike verify-claims.js (which only reads the DRAFTED signals in scope), this
   scanner reads the ENTIRE applied content tree, because the user's requirement is
   to review the whole page every cycle, not just the signals a trigger touched.

   Returns a plain object the runner folds into the quality report. The runner
   (not this module) decides how it affects the verdict / publish bar.
   ===========================================================================*/

/* ---------- curated jargon list ----------
   Each entry: a whole-word/phrase pattern (case-insensitive) that a layperson
   would NOT immediately understand. Ordered roughly by how often it shows up in
   macro copy. Phrases are matched before bare words so "basis points" is caught
   as a phrase. This list is intentionally conservative: only terms that genuinely
   need a plain-English gloss. Plain words ("prices", "jobs", "growth") are NOT
   here. Keep additions narrow and defensible — every term here can HARD-BLOCK a
   publish, so a false positive costs a held cycle. */
const JARGON_TERMS = [
  // inflation / price family
  "year-over-year", "year over year", "yoy", "y/y",
  "month-over-month", "month over month", "mom", "m/m",
  "core inflation", "headline inflation", "disinflation", "deflation",
  "sequential", "annualized", "seasonally adjusted",
  // rates / monetary family
  "basis points", "bps", "yield curve", "inverted yield curve",
  "quantitative tightening", "quantitative easing", "balance sheet runoff",
  "net liquidity", "real yield", "nominal", "duration",
  "hawkish", "dovish", "terminal rate", "neutral rate",
  // survey / index family
  "diffusion index", "diffusion", "purchasing managers", "pmi",
  "percentile", "z-score", "standard deviation", "trailing twelve",
  "ttm", "moving average", "base effect", "base effects",
  // macro aggregates
  "gdp", "cpi", "ppi", "pce", "nonfarm", "payrolls",
  "labor force participation", "u-3", "u-6", "jolts",
  // markets / finance framing
  "equities", "fixed income", "spreads", "valuation multiple",
  "risk-on", "risk-off", "soft landing", "hard landing",
  "leading indicator", "lagging indicator", "procyclical", "countercyclical"
];

// Build a single regex per term with word boundaries that tolerate the term's own
// punctuation (hyphens, slashes). We compile once.
function compileTermPatterns(terms) {
  return terms.map((t) => {
    // escape regex metachars, then allow the literal hyphen/slash/space as written
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // (^|[^a-z0-9]) ... ([^a-z0-9]|$) to behave like a whole-token match while
    // letting multi-word phrases match across single spaces as written.
    return { term: t, re: new RegExp("(^|[^a-z0-9])(" + esc + ")([^a-z0-9]|$)", "i") };
  });
}
const TERM_PATTERNS = compileTermPatterns(JARGON_TERMS);

/* ---------- explanation cues ----------
   A flagged jargon term is forgiven when the SAME prose string also contains an
   explanation cue: an em/en dash gloss, parenthetical, or a "means/that is/which
   is/i.e." phrasing. The editorial contract already asks the agent to explain a
   term the first time it appears ("diffusion index" -> "a survey score where
   positive means growing"); this is how the scanner credits that. The cue must
   appear in the same string as the term (not three paragraphs away) so the reader
   actually gets the gloss in context. */
const EXPLANATION_CUE = /(?:[\u2014\u2013\-]\s)|(?:\([^)]{6,}\))|(?:\b(?:which (?:is|means|measures)|that is|in other words|meaning|i\.e\.|a (?:survey|measure|score|gauge|reading) (?:of|where|that))\b)/i;

/* ---------- prose extraction over the WHOLE applied content tree ----------
   Collect every reader-facing string on the page. We deliberately walk the live
   content object (the APPLIED tree the gate builds), not the draft, because the
   requirement is to clear the WHOLE page, including sections this cycle's trigger
   did not touch. We skip non-prose fields (ids, dates, urls, numeric/value fields,
   sources, status enums) — those are not graded for clarity and would create
   noise. Each collected item carries a path label for actionable reporting. */
// Machine / non-prose fields we NEVER descend into. These carry ids, source
// labels, enums, numbers, dates, urls — grading them for "jargon" or reading
// level is meaningless and produces false positives (e.g. the signal id
// "cpi-headline" or the source label "BLS CPI" are not reader prose).
const SKIP_KEYS = new Set([
  "id", "signal_id", "signal_ids", "signals_used", "category", "category_label",
  "status", "status_tone", "alignment_status", "current_value", "current_unit",
  "confidence", "last_updated", "source_note", "reference_point", "date",
  "date_label", "editorial_freshness", "review_required",
  "narrative_review_required", "review_note", "last_editorial_reviewed",
  "default_lens", "connected_signals", "curated", "where_helper", "sources",
  "url", "label_short", "pill_label_short", "schema_version", "generated_at",
  "phase", "phase_meta", "source_philosophy", "data_points", "compared_to",
  "percentile", "thresholds", "cadence", "editorial_polarity", "momentum",
  "delta_pct", "value", "unit", "label", "chip_label", "tier", "owner",
  "editorial_owner", "reference_points"
]);

// Reader-facing prose fields we DO grade, wherever they appear in the tree.
// A string (or an array of strings, e.g. body_paragraphs / counterarguments) is
// graded ONLY when its key is in this allowlist. This is allowlist-driven on
// purpose: any new machine field added later is ignored by default, never
// accidentally graded as prose.
const PROSE_KEYS = new Set([
  "title", "subtitle", "summary", "text", "expansion", "headline",
  "evidence", "counter_signal", "product_takeaway", "observation",
  "why_it_matters", "pm_implication_default", "decision_this_week",
  "pattern", "action", "sketchbook_note", "momentum_label",
  "weekly_note_text", "pm_tension_question", "pm_tension_note",
  "note", "question", "body_paragraphs", "lead", "blurb",
  "reasoning", "counterarguments", "what_would_make_us_wrong"
]);

function collectProse(node, pathPrefix, out, proseContext) {
  if (node == null) return;
  if (typeof node === "string") {
    // Only capture a bare string when we are inside a PROSE_KEY context (e.g. an
    // element of body_paragraphs[] or counterarguments[]).
    if (proseContext) {
      const s = node.trim();
      if (s) out.push({ path: pathPrefix, text: s });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectProse(v, pathPrefix + "[" + i + "]", out, proseContext));
    return;
  }
  if (typeof node === "object") {
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      const child = node[k];
      const childPath = pathPrefix ? pathPrefix + "." + k : k;
      const isProseKey = PROSE_KEYS.has(k);
      if (typeof child === "string") {
        if (isProseKey) {
          const s = child.trim();
          if (s) out.push({ path: childPath, text: s });
        }
        // bare string on a non-prose, non-skip key -> ignore (defensive)
      } else {
        // Descend. If the key itself is a prose key (e.g. body_paragraphs,
        // counterarguments), mark the context so string ELEMENTS get captured.
        collectProse(child, childPath, out, isProseKey);
      }
    }
  }
}

// Paths the editorial layer is FORBIDDEN to rewrite (mirrors the READ-ONLY list
// in automation/editable-fields-map.md). The clarity gate can REPORT jargon found
// in these (for transparency), but must not BLOCK publish on them — the editor
// has no power to fix them, so blocking would make publish impossible forever.
//
// As of Phase 3 the why_we_think_this PROSE subfields (reasoning, counterarguments,
// what_would_make_us_wrong) are editable, so they are NO LONGER read-only — the
// macro-editor has full-page authority and must clean their jargon. The only
// read-only piece, why_we_think_this.signals_used, is a machine list already in
// SKIP_KEYS, so it is never collected as prose in the first place. There are
// therefore currently NO read-only prose paths; READONLY_PATH is an empty matcher
// kept as an explicit, auditable hook should a future read-only prose field appear.
const READONLY_PATH = /$.^/; // matches nothing
function isEditablePath(p) { return !READONLY_PATH.test(p); }

// Top-level entry: returns [{path, text}] for every graded prose string on the page.
function extractPageProse(content) {
  const out = [];
  if (!content) return out;
  // body_paragraphs are arrays of strings under weekly_connection — collectProse
  // labels them weekly_connection.body_paragraphs[0] etc. Everything else nests
  // naturally. We pass the whole object; the top level is not itself a prose key.
  collectProse(content, "", out, false);
  return out;
}

/* ---------- jargon scan ---------- */
function scanJargon(text) {
  const hits = [];
  const explained = EXPLANATION_CUE.test(text);
  for (const { term, re } of TERM_PATTERNS) {
    if (re.test(text)) {
      hits.push({ term, explained });
    }
  }
  return hits;
}

/* ---------- deterministic readability (Flesch-Kincaid grade) ----------
   A coarse, reproducible floor. Not a substitute for the validation agent's
   human-style judgement — but it cannot be talked up. We count words, sentences,
   and syllables with simple heuristics. */
function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  // strip common silent endings
  let s = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = s.match(/[aeiouy]{1,2}/g);
  const n = groups ? groups.length : 1;
  return Math.max(1, n);
}

function splitSentences(text) {
  // split on . ! ? followed by space/end; keep it simple and deterministic
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitWords(text) {
  return String(text).split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

// Flesch-Kincaid grade for one block of text. Returns {grade, words, sentences}.
function fkGrade(text) {
  const sentences = splitSentences(text);
  const words = splitWords(text).filter((w) => /[a-z]/i.test(w));
  const nSent = Math.max(1, sentences.length);
  const nWord = words.length;
  if (nWord === 0) return { grade: 0, words: 0, sentences: nSent };
  let syll = 0;
  words.forEach((w) => { syll += countSyllables(w); });
  // FK grade = 0.39*(words/sentences) + 11.8*(syllables/words) - 15.59
  const grade = 0.39 * (nWord / nSent) + 11.8 * (syll / nWord) - 15.59;
  return { grade: Math.round(grade * 10) / 10, words: nWord, sentences: nSent };
}

/* ---------- main entry ----------
   scanPage(content, options)
     content — the APPLIED content tree (post-apply, pre-publish) OR live content.
     options — { gradeMax = 9, sentenceGradeMax = 12 }
                 gradeMax: hard cap on the WHOLE-PAGE FK grade.
                 sentenceGradeMax: hard cap on the single HARDEST sentence's FK grade
                                   (a coarse outlier guard; set generously because a
                                   single number-dense sentence can spike).

   Returns:
     {
       pass,                         // no hard clarity failure
       jargon_clean,                 // no unexplained jargon anywhere
       grade_ok,                     // whole-page grade <= gradeMax
       page_grade,                   // whole-page FK grade
       hardest_sentence_grade,       // worst single-sentence FK grade
       hardest_sentence,             // that sentence (for reporting)
       hardest_sentence_path,        // where it lives
       unexplained_jargon: [{term, path, snippet}],
       explained_jargon:   [{term, path}],   // informational; not blocking
       sections_scanned,             // count of prose strings graded
       hard_failures: [{check, field, detail}],
       soft_warnings:  [{check, field, detail}]
     }
*/
function scanPage(content, options) {
  options = options || {};
  const gradeMax = options.gradeMax != null ? Number(options.gradeMax) : 9;
  const sentenceGradeMax = options.sentenceGradeMax != null ? Number(options.sentenceGradeMax) : 12;

  // gateScope: "editable" (default) gates ONLY on prose the editor can rewrite;
  // read-only findings (e.g. why_we_think_this) are reported but never block.
  // "page" gates on the WHOLE page (use only if every prose field is editable).
  const gateScope = options.gateScope === "page" ? "page" : "editable";
  const gatePath = gateScope === "page" ? (() => true) : isEditablePath;

  const allProse = extractPageProse(content);
  // Prose the gate is allowed to act on.
  const prose = allProse.filter((x) => gatePath(x.path));
  // Read-only prose: scanned for transparency, never blocks.
  const readonlyProse = allProse.filter((x) => !gatePath(x.path));

  const hard = [];
  const soft = [];
  const unexplained = [];      // blocking (editable scope)
  const explained = [];
  const readonly_jargon = [];  // informational only (read-only fields)

  // --- jargon over GATED prose (blocking) ---
  for (const { path: p, text } of prose) {
    const hits = scanJargon(text);
    for (const h of hits) {
      if (h.explained) {
        explained.push({ term: h.term, path: p });
      } else {
        const idx = text.toLowerCase().indexOf(h.term.toLowerCase());
        const snippet = idx >= 0
          ? text.slice(Math.max(0, idx - 20), idx + h.term.length + 20)
          : text.slice(0, 60);
        unexplained.push({ term: h.term, path: p, snippet: snippet.trim() });
        hard.push({
          check: "jargon",
          field: p,
          detail: "unexplained jargon \"" + h.term + "\" — \u2026" + snippet.trim() + "\u2026"
        });
      }
    }
  }

  // --- jargon over READ-ONLY prose (informational; never blocks) ---
  for (const { path: p, text } of readonlyProse) {
    const hits = scanJargon(text);
    for (const h of hits) {
      if (!h.explained) readonly_jargon.push({ term: h.term, path: p });
    }
  }

  // --- readability over GATED prose ---
  const pageText = prose.map((x) => x.text).join(" ");
  const page = fkGrade(pageText);
  const gradeOk = page.grade <= gradeMax;
  if (!gradeOk) {
    hard.push({
      check: "reading_grade",
      field: "page",
      detail: "editable-prose reading grade " + page.grade + " exceeds max " + gradeMax
    });
  }

  // --- hardest single sentence among GATED prose (outlier guard) ---
  let worst = { grade: 0, sentence: "", path: "" };
  for (const { path: p, text } of prose) {
    for (const sent of splitSentences(text)) {
      // ignore very short fragments (labels, chips) — they skew FK
      if (splitWords(sent).length < 6) continue;
      const g = fkGrade(sent).grade;
      if (g > worst.grade) worst = { grade: g, sentence: sent, path: p };
    }
  }
  if (worst.grade > sentenceGradeMax) {
    // a single hard sentence is a SOFT warning, not a hard block — the page-level
    // grade is the hard gate; one number-heavy sentence shouldn't hold the page.
    soft.push({
      check: "reading_grade_sentence",
      field: worst.path,
      detail: "hardest sentence grade " + worst.grade + " > " + sentenceGradeMax + ": \"" + worst.sentence.slice(0, 120) + "\""
    });
  }

  const jargonClean = unexplained.length === 0;
  const pass = jargonClean && gradeOk;

  return {
    pass,
    gate_scope: gateScope,
    jargon_clean: jargonClean,
    grade_ok: gradeOk,
    page_grade: page.grade,
    hardest_sentence_grade: worst.grade,
    hardest_sentence: worst.sentence,
    hardest_sentence_path: worst.path,
    unexplained_jargon: unexplained,
    explained_jargon: explained,
    readonly_jargon: readonly_jargon,
    sections_scanned: prose.length,
    readonly_sections_scanned: readonlyProse.length,
    hard_failures: hard,
    soft_warnings: soft
  };
}

module.exports = {
  scanPage,
  extractPageProse,
  scanJargon,
  fkGrade,
  countSyllables,
  splitSentences,
  isEditablePath,
  JARGON_TERMS,
  EXPLANATION_CUE
};
