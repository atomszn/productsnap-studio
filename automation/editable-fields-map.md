# Pulse Editorial — Editable vs Read-Only Field Map

Single source of truth for which `data/pulse-content.json` paths the editorial
automation may write. The content-draft schema (`automation/schemas/content-draft.schema.json`),
the drafter / macro-editor contract, and the editorial-only diff guard
(`scripts/lib/apply-editorial.js`) all enforce this list. If you add a new prose field to the
page, add it here AND to: the schema, `SIGNAL_EDITABLE_KEYS` in `apply-editorial.js`, and
`signalProseStrings()` in `scripts/lib/verify-claims.js` (so its numbers are reconciled).

Legend: paths use `[]` for "every array element" and `{a,b}` for a set of sibling keys.

## EDITABLE — Phase 2 may draft / replace (prose only)

### Per signal — `signals[]`
- `title`                       — headline for the signal card
- `summary`                     — the plain-language paragraph
- `status`                      — single status word (drives polarity gate; pick honestly)
- `status_tone`                 — `green | amber | neutral | red` (visual tone only)
- `momentum_label`             — short momentum phrase
- `pill_label_short`           — compact pill text
- `chain[].text`               — each reasoning-chain step body
- `chain[].expansion`          — each chain step's "more" text
- `refined_why.evidence`
- `refined_why.counter_signal`
- `refined_why.product_takeaway`
- `why_we_think_this.reasoning`              — (Phase 3) the plain-language "why we believe this"
- `why_we_think_this.counterarguments[]`     — (Phase 3) each counter-point, plain language
- `why_we_think_this.what_would_make_us_wrong` — (Phase 3) the falsifier statement

### Weekly Connection — `weekly_connection`
- `title`, `subtitle`
- `body_paragraphs[]`
- `refined.observation`
- `refined.why_it_matters`
- `refined.pm_implication_default`
- `refined.decision_this_week`
- `date`, `date_label`          — the WC dateline (editorial freshness stamp)

### Weekly Thought — `weekly_thought`  (NEW in Phase 2 scope)
- `headline`
- `lenses.{build,customer,business,future}.label`
- `lenses.{build,customer,business,future}.pattern`
- `lenses.{build,customer,business,future}.action`
- `lenses.{build,customer,business,future}.sketchbook_note`

### Top-level prose
- `weekly_note.text`
- `pm_tension.question`
- `pm_tension.note`

### Bookkeeping (set by trust recompute, NOT hand-authored — listed so the diff guard allows them)
- per signal: `last_editorial_reviewed`, `alignment_status`, `review_required`, `editorial_freshness`, `status_meta`, `timestamps`
- `weekly_connection`: `last_editorial_reviewed`, `review_required`, `narrative_review_required`, `review_note`, `editorial_freshness`
- `weekly_thought`: `last_editorial_reviewed`

## READ-ONLY — MUST NOT CHANGE (abort publish if any of these move)

### Per signal — `signals[]`
- `id`, `category`, `category_label`
- `current_value`, `current_unit`
- `data_points[]`              — the actual time series
- `compared_to`               — vs_1mo / vs_6mo / vs_12mo deltas + directions
- `percentile`
- `confidence`, `tier`
- `last_updated`              — data observation date (NOT the editorial review date)
- `sources[]`                — source names + URLs (app/agency links)
- `source_note`, `term_glossary`, `reference_point`, `data_points_window_months`
- `why_we_think_this.signals_used`   — machine list of which signals this reasoning draws on (NOT prose)
- `personal_overrides`

> NOTE (Phase 3): the `why_we_think_this` PROSE subfields (`reasoning`, `counterarguments[]`,
> `what_would_make_us_wrong`) are now EDITABLE (listed above) so the macro-editor can clear jargon
> from the whole page. Only `why_we_think_this.signals_used` remains read-only and the diff guard
> aborts publish if it moves.

### Elsewhere
- everything in `signals_registry.json`
- `weekly_connection.connected_signals`, `weekly_connection.curated`, `where_helper`
- `categories`, `source_philosophy`, `phase_meta`, `whats_changed`
- app store links anywhere
- every GitHub workflow and `automation-config.json` trust gate

## Number-reconciliation allowlist (non-data illustrative numbers)

Numbers that legitimately appear in prose but are NOT signal data — the reconciler allows
these without a data match (kept deliberately tiny; extend only with review):
- small counts used rhetorically: `1, 2, 3` (e.g. "two more months", "one region")
- round timeframes: `6` / `7` / `12` (months/days windows that match registry windows)
- the literal current year and adjacent years

Every OTHER number in prose must reconcile to a real data value or the gate trips RED.
