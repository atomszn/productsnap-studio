"use strict";
/* =============================================================================
   narrative-consistency.js — detect when the NEW draft REVERSES the PREVIOUSLY
   PUBLISHED narrative for the same signal                          (Phase 3)
   -----------------------------------------------------------------------------
   Dependency-free (Node standard library + pulse-trust only). Pure functions: no
   network, no process.exit, no file writes.

   A reversal is when the editorial DIRECTION for a signal flips between the live
   (previously published) page and the applied draft — e.g. last week said
   "cooling / falling / improving" and this week says the opposite for the same
   signal. Two cases, handled very differently:

     · SUPPORTED reversal — the narrative flipped AND the signal's own DATA
       direction also moved (data legitimately reversed). This is normal; surface
       it as a SOFT warning the AI panel must EXPLICITLY acknowledge before a GREEN
       can publish (the runner downgrades GREEN->YELLOW unless every judge set
       narrative_reversal_acknowledged). Never a hard block by itself.

     · UNSUPPORTED reversal — the narrative flipped but the DATA direction did NOT
       move to support it. That is a real integrity concern (the prose changed its
       story while the numbers say the same thing), so it is a HARD failure.

   Editorial direction per signal is derived deterministically from the `status`
   word resolved through the signal's editorial polarity, reusing the EXACT mapping
   the live trust layer uses (pulse-trust.statusToExpectedDirection). Data
   direction is the signal's own compared_to.vs_12mo.direction (the same field
   pulse-trust trusts), with a data_points fallback. Because the editorial diff
   guard guarantees data fields are byte-identical between live and applied, the
   data direction is the same on both sides at gate time; "data did not support the
   reversal" therefore means "the value direction is steady while the prose flipped".

   Returns a plain object the runner folds into the quality report. The runner
   (not this module) decides how it affects the verdict / publish bar.
   ===========================================================================*/

const trust = require("./pulse-trust");

// Resolve a signal's editorial DIRECTION (up/down/flat/null) from its status word
// through the registry's editorial_polarity. We reuse trust.checkEditorialAlignment,
// which resolves the status word into an `expected_direction` (the value-direction
// the prose claims) via the SAME polarity logic the live page masks on. null = no
// fixed direction (e.g. "watch", "mixed", "steady", a categorical signal) — those
// can never form a reversal.
function editorialDirection(signal, registry) {
  if (!signal || !signal.status || !registry) return null;
  const entry = trust.getRegistryEntry(registry, signal.id);
  if (!entry) return null;
  const align = trust.checkEditorialAlignment(registry, signal, entry);
  const dir = align && align.expected_direction;
  if (dir === "up" || dir === "down") return dir;
  return null; // "flat" / null -> not a directional stance, cannot reverse
}

// The signal's underlying DATA direction (up/down/flat/null), reusing the same
// computation the trust layer uses for alignment.
function dataDirection(signal, registry) {
  if (!signal) return null;
  const entry = registry ? trust.getRegistryEntry(registry, signal.id) : null;
  const dir = trust.computeDataDirection(signal, entry);
  if (dir === "up" || dir === "down") return dir;
  return null;
}

function isReversal(prevDir, newDir) {
  return (prevDir === "up" && newDir === "down") || (prevDir === "down" && newDir === "up");
}

function excerpt(signal) {
  if (!signal) return "";
  const s = [signal.status, signal.summary].filter(Boolean).join(" — ");
  return s.slice(0, 160);
}

/* ---------- main entry ----------
   checkConsistency(prevContent, appliedContent, opts)
     prevContent    — the live/previous content (data/pulse-content.json on disk).
     appliedContent — the post-apply tree the draft would publish.
     opts           — { registry } the signals registry (for editorial polarity +
                      data direction). Optional; without it, polarity defaults to
                      neutral and only explicit STATUS_WORD_DIRECTION words resolve.

   Returns:
     {
       pass,                 // false iff any UNSUPPORTED reversal (hard concern)
       reversals: [{ signal_id, prev_polarity, new_polarity,
                     prev_excerpt, new_excerpt, supported }],
       soft_warnings: [{ signal_id, detail }],   // supported reversals (panel must clear)
       hard_failures: [{ signal_id, detail }]    // unsupported reversals (hard block)
     }
*/
function checkConsistency(prevContent, appliedContent, opts) {
  opts = opts || {};
  const registry = opts.registry || null;

  const prevById = {};
  ((prevContent && prevContent.signals) || []).forEach((s) => { if (s && s.id) prevById[s.id] = s; });
  const newById = {};
  ((appliedContent && appliedContent.signals) || []).forEach((s) => { if (s && s.id) newById[s.id] = s; });

  const reversals = [];
  const soft = [];
  const hard = [];

  Object.keys(newById).forEach((id) => {
    const prev = prevById[id];
    const next = newById[id];
    if (!prev || !next) return; // a signal only present on one side can't reverse

    const prevDir = editorialDirection(prev, registry);
    const newDir = editorialDirection(next, registry);
    if (!prevDir || !newDir) return;        // need a directional stance on BOTH sides
    if (!isReversal(prevDir, newDir)) return;

    // The reversal is SUPPORTED only if the DATA direction agrees with the NEW
    // narrative direction. Because data is identical on both sides at gate time,
    // we read it from the applied signal (== live signal data).
    const dataDir = dataDirection(next, registry);
    const supported = dataDir != null && dataDir === newDir;

    const rev = {
      signal_id: id,
      prev_polarity: prevDir,
      new_polarity: newDir,
      prev_excerpt: excerpt(prev),
      new_excerpt: excerpt(next),
      supported
    };
    reversals.push(rev);

    if (supported) {
      soft.push({
        signal_id: id,
        detail: "editorial direction reversed " + prevDir + "->" + newDir +
          " and the data direction (" + dataDir + ") supports it — panel must explicitly acknowledge"
      });
    } else {
      hard.push({
        signal_id: id,
        detail: "editorial direction reversed " + prevDir + "->" + newDir +
          " but the data direction (" + (dataDir || "steady/unavailable") + ") does NOT support the flip"
      });
    }
  });

  return {
    pass: hard.length === 0,
    reversals,
    soft_warnings: soft,
    hard_failures: hard
  };
}

module.exports = {
  checkConsistency,
  editorialDirection,
  dataDirection,
  isReversal
};
