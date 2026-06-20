# ProductSnap Pulse — Phase 2 Editorial Automation (Design)

**Status:** proposed (this build) · **Author:** automation · **Last reviewed:** 2026-06-19

This document explains, before any code, WHAT Phase 2 does, WHY each piece exists, and
exactly what is allowed to reach the live page. It is the companion to the Phase 1
research contract (`automation/prompts/research.md`) and reuses every Phase 1 convention.

---

## 1. What the user asked for (verbatim intent)

> "I would like it to be automated but after double checking and triple checking the
> content against the data points. Everything has to flow through seamlessly and provide
> a friction free and effortless clarity experience."

Three decisions locked this session:

1. **Weekly Thought is in scope.** The top hiring/AI headline and its 4 lens tabs
   (`build / customer / business / future`) are drafted by Phase 2, not just the signals.
2. **Cadence = event-driven + weekly floor.** Re-draft only when something materially
   changes (a signal moves, or prose now contradicts data) AND at least once every 7 days
   so the page never goes stale. Realistically ~weekly. Refreshes must "stand out... be
   valuable and impactful," not churn.
3. **Auto-publish on GREEN.** A draft that passes ALL automated gates auto-merges to live
   immediately. YELLOW opens a review PR and notifies. RED holds safe + review PR + notify.

Non-negotiable guardrails (carried from Phase 1, still binding):

- Never change signal **data values**, app-store links, trust gates, or workflows. Phase 2
  edits **editorial prose only**.
- Dependency-free (Node built-ins + local schema validator), deterministic, reviewable.
- Audience = laymen (recruiters, hiring managers). Reading grade ≤ 9. "A high schooler
  should still understand what we are talking about."
- Depth goal: macro signal → user/customer behavior → product strategy, so a PM/founder
  occasionally thinks "I hadn't connected those dots."
- Kill-switch + budget governor always respected. $100/mo hard cap, ≤$50/mo target.

---

## 2. The pipeline (end to end)

Phase 1 already produces **research findings** (sourced, structured, fingerprinted) on a
DRAFT event. Phase 2 adds three stages downstream of findings, each cleanly separated so AI
never touches deterministic I/O:

```
 (Phase 1)                        (Phase 2 — this build)
 decision DRAFT                                                          live page
      │                                                                      ▲
      ▼                                                                      │
 emit-editorial-task ─► research agent ─► findings ─► DRAFT ─► VALIDATE ─► GATE ─┤
   (deterministic)        (gpt_5_5)        .json     editorial  validation  deterministic
                                                     agent       agent      reconciler +
                                                   (opus_4_8)  (gemini_3_1) schema + tests
                                                        │           │            │
                                                        ▼           ▼            ▼
                                              content-draft   quality-report   GREEN→auto-merge
                                                  .json          .json         YELLOW/RED→review PR
```

Two-step-per-stage design (mirrors `research-runner.js --prep/--ingest`):

| Stage      | runner command                              | AI model (registry role) | Writes                          |
|------------|---------------------------------------------|--------------------------|---------------------------------|
| Draft      | `--draft-prep` → agent → `--draft-ingest`   | `editorial` (opus_4_8)   | `data/pulse-content-draft.json` |
| Validate   | `--validate-prep` → agent → `--validate-ingest` | `validation` (gemini_3_1) | `data/pulse-quality-report.json` (AI half) |
| Gate       | `--gate`                                    | none (deterministic)     | final verdict GREEN/YELLOW/RED  |

The **validation agent is deliberately a different provider than the editorial agent**
(Gemini checking Claude) to avoid same-model blind spots. The **gate is pure code** — the
final word on whether anything publishes is deterministic, never an LLM self-grade.

---

## 3. Scope: exactly which fields Phase 2 may write

Phase 2 writes ONLY editorial/prose fields. Everything else is read-only context. The
authoritative boundary lives in `automation/editable-fields-map.md` and is enforced two ways:
(a) the content-draft schema only has slots for editable fields, and (b) the apply step uses
an **editorial-only diff guard** that aborts if any non-editorial path changed.

**EDITABLE (Phase 2 may draft/replace):**

- Per signal: `title`, `summary`, `status`, `status_tone`, `momentum_label`,
  `pill_label_short`, `chain[].text`, `chain[].expansion`, `refined_why.{evidence,
  counter_signal, product_takeaway}`.
- Weekly Connection: `title`, `subtitle`, `body_paragraphs[]`, `refined.{observation,
  why_it_matters, pm_implication_default, decision_this_week}`, `date`, `date_label`.
- Weekly Thought: `headline`, `lenses.{build,customer,business,future}.{label,pattern,
  action,sketchbook_note}`.
- Top-level prose: `weekly_note.text`, `pm_tension.{question,note}`.
- Freshness bookkeeping the validator already recomputes: `last_editorial_reviewed`,
  `alignment_status`, `review_required` (set by trust recompute, not hand-typed).

**MUST NOT CHANGE (read-only data — abort if touched):**

- `current_value`, `current_unit`, `data_points`, `compared_to`, `percentile`, `sources`,
  `last_updated`, `tier`, `confidence`, `id`, `category`, every field in
  `signals_registry.json`, app-store links, anything in `automation-config` trust gates,
  any GitHub workflow.

---

## 4. The triple-check (why "GREEN" is trustworthy)

The user's core requirement is "double check and triple check the content against the data
points." Three independent layers must ALL agree before GREEN:

**Check 1 — Deterministic reconciler (`scripts/lib/verify-claims.js`, pure code, no AI).**
This is the spine. For the drafted prose it verifies, mechanically:

- **Numbers reconcile.** Every numeric token in editorial prose must either (a) match a
  value present in the signal's real data (`current_value`, any `data_points[].value`,
  `compared_to.*.delta_pct`, `percentile.value`) within rounding tolerance, or (b) be on a
  small allowlist of non-data illustrative numbers (e.g. "2 months", "every few weeks"). Any
  unexplained number → RED (a fabricated figure is the worst failure).
- **Polarity / direction agrees.** Reuses `pulse-trust.checkEditorialAlignment` — the drafted
  `status` word, read through `editorial_polarity`, must match `computeDataDirection`. A
  mismatch means the prose says "growing" while the data fell → RED. (This is the exact bug
  that bit the live-page fix; the gate now catches it automatically.)
- **Narrative coherence.** Reuses `pulse-trust.checkNarrativeAlignment` — the Weekly
  Connection prose direction must not contradict the aggregate signal directions → RED if it
  does.
- **No banned advice.** Regex/keyword scan for investment-advice / market-prediction
  framing ("buy", "sell", "will rise to", "price target") → RED.
- **Freshness honesty.** Any `last_editorial_reviewed` the draft sets must be today, and the
  resulting `review_required` (recomputed by the existing validator) must be false for edited
  items, or the gate will not call it GREEN.

**Check 2 — AI validation agent (`gemini_3_1_pro`, different provider).** Independently reads
the draft against the findings + data and scores: reading grade, one-voice cohesion,
honesty (no overclaiming beyond findings), disclaimer respected, and lists any unsupported
claim. Produces a `confidence` 0–1. This catches *meaning* errors code can't (e.g. prose that
is numerically fine but misleading).

**Check 3 — Schema + existing test suites.** The draft must pass `content-draft.schema.json`;
the post-apply tree must pass all 5 existing `scripts/test/*` suites + the data-validate
recompute. A draft that breaks any test cannot be GREEN.

### Verdict mapping (deterministic, in `--gate`)

| Verdict | Condition |
|---------|-----------|
| **RED** | ANY: a number doesn't reconcile · polarity/narrative mismatch · banned advice · grade > 9 · schema invalid · any test fails · non-editorial diff detected · validation confidence < 0.70 |
| **YELLOW** | No RED trip, but validation confidence in **[0.70, 0.85)** OR reconciler raised a soft warning (e.g. an allowlisted-but-unusual number). |
| **GREEN** | No RED trip AND validation confidence **≥ 0.85** AND reconciler clean AND all tests/schema pass. |

`confidence_threshold` (0.85) and `reading_grade_target_max` (9) come from
`automation-config.json` — tunable without code change.

---

## 5. Publish behavior

- **GREEN** → the apply step writes the editorial fields into `data/pulse-content.json`,
  runs the editorial-only diff guard (abort if any data path moved), runs all 5 tests +
  data-validate, and produces a **single revertable merge commit** on a short-lived branch
  that auto-merges to `main`. Live page rebuilds in ~1–2 min. Because the diff is
  editorial-only and the commit is atomic, any bad publish is one `git revert` away.
- **YELLOW / RED** → nothing touches live. The draft + quality report are committed to a
  review-only PR (same Option A pattern as Phase 1 shadow findings) and the user is notified
  with the verdict, the reason, and the PR link.

Auto-publish is **earned every run**. The master switches (`auto_publish_enabled`,
`kill_switch`, `shadow_mode`) still exist: if `auto_publish_enabled` is false or the
kill-switch is off, even a GREEN draft only opens a review PR — so the user can dry-run Phase 2
in "draft + gate but don't publish" mode before flipping the final switch.

---

## 6. Cadence (event-driven + 7-day floor)

No new scheduler is invented. The existing trigger logic (`scripts/draft-editorial.js`)
already fires DRAFT on (a) a material data move on a new observation, (b) narrative review
required, or (c) editorial stale past its 7-day window. That IS "event-driven + weekly floor":
(a)/(b) are the events, (c) is the floor. Phase 2 simply consumes those DRAFT events. On KEEP
days nothing drafts, nothing spends, nothing publishes.

---

## 7. Safety properties (why this can't quietly break the live site)

1. **Editorial-only diff guard** — apply aborts if any non-prose path changed. Data values
   are structurally unreachable by the editorial path.
2. **Deterministic final gate** — an LLM can never self-approve; pure code decides GREEN.
3. **Different-provider cross-check** — Gemini validates Claude's prose.
4. **All existing trust gates still run** — alignment, narrative, freshness, last-known-good
   are untouched and still recompute on every data refresh.
5. **Atomic, revertable publish** — one merge commit, editorial-only, trivially revertable.
6. **Kill-switch + budget governor + shadow/auto-publish master flags** — multiple independent
   off-ramps.
7. **Idempotency by fingerprint** — re-running the same event never double-publishes.

Nothing in this build auto-publishes until the user merges THIS build PR and (separately)
`auto_publish_enabled` is true with the kill-switch on. The build PR ships Phase 2 in a safe
default: drafts + gates run, GREEN is computed, but the user chooses when to arm auto-publish.
