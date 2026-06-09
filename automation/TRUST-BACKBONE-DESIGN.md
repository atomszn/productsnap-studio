# Pulse Trust Backbone + 36-Month History — Design

Status: PROPOSED (for review). No live data, links, gates, or workflows change until this PR is reviewed and merged. Branch: `feature/pulse-trust-backbone-and-history`. Never touches `main` directly.

## Why

A visitor (recruiter, hiring manager, salon owner, job seeker) must be able to trust every number on the Pulse page. Today the pipeline fetches values and validates them *structurally* (in range, valid date, right unit, source mapped) but never re-confirms that the **displayed value equals what the primary source actually published**. This design closes that gap and deepens the history so the page can say "vs last month, vs a year ago, vs three years ago" honestly.

## Scope (this PR)

1. **Source-verification gate** — independently re-fetch each automated signal's latest observation from FRED/BLS and confirm the stored value + date match the source.
2. **Cadence + next-release table** — an auditable artifact covering all 20 signals.
3. **Trigger-freshness fix** — a DRAFT only fires on an observation that is genuinely new since the last draft (kills the "month-old move re-triggers" bug).
4. **36-month history** — extend stored `data_points` from 12 → 36 months and enrich `compared_to` with real reference points.

Out of scope (later tracks): page reframe (Track 3), AI editorial synthesis + quality gate (Track 4 / Phase 2-3).

## Invariants (unchanged, enforced)

- Never push to or merge into `main`. Feature branch + PR only.
- Never change app store links, trust gates' intent, or core editorial content.
- The deterministic GitHub pipeline stays dependency-free (Node built-ins only; no npm).
- Editorial-preservation guard still holds: only data fields (`current_value`, `data_points`, `compared_to`, `percentile`, `last_updated`, `timestamps`) may change.
- Curated Tier-2/3 signals are never given an "automated/verified-against-source" badge they didn't earn.

---

## 1. Source-verification gate — `scripts/verify-pulse-sources.js`

A standalone, deterministic script run as a workflow step **after** `fetch-pulse-data.js` and **before** the commit gates. It re-fetches each automated signal independently (decision: independent re-fetch, strongest guarantee) and compares the freshly fetched latest observation to what is now stored in `data/pulse-content.json`.

It reuses the **exact same fetch + transform logic** as the fetcher (FRED/BLS observation pull → `prepareSeries` transform → `formatCurrentValue`). Verifying against a different code path would be meaningless; verifying against the same transform proves the stored value is reproducible from the source today.

### Per signal, the gate computes a verdict:

- **MATCH** — stored `current_value` and `last_updated` equal the freshly fetched, identically-transformed source value/date (within float tolerance for rounding). No action.
- **VALUE_DRIFT (auto-correctable)** — the source has a *different value for the same (or a newer) valid observation date*, and that value passes all structural checks (numeric, in expected range, valid non-future date, non-decreasing date). Decision: **auto-correct** the stored data fields to the source value, then notify. This is the only auto-write case and is fully logged (old → new, source URL, observation date).
- **STRUCTURAL_FAIL (hard-fail, never auto-correct)** — source returns nothing, an empty/`.` value, a future date, a value outside the signal's `expected_range`, or a date that would move *backward*. Auto-correcting on garbage is worse than failing. The run **fails**, last-known-good stays untouched, and the user is notified to investigate. (This guardrail is added deliberately on top of the "auto-correct" decision — auto-correct applies only to clean, in-range disagreements, not to malformed source responses.)
- **SKIP** — curated Tier-2/3 signals (no free API). The gate records them as "not source-verifiable (curated)" — honest, not a pass.

### Output

- Writes `data/pulse-source-verification.json`: per-signal `{ id, verdict, stored_value, source_value, observation_date, source_url, action_taken, checked_at }`, plus a run summary. This is the auditable proof a visitor's number was checked.
- Exit code: `0` if every automated signal is MATCH or auto-corrected cleanly; non-zero on any STRUCTURAL_FAIL (fails the workflow before commit).

### Fail-safe ordering in the workflow

```
fetch-pulse-data.js            (writes values, keeps last-known-good on fetch failure)
verify-pulse-sources.js   <==  NEW: re-fetch + compare; auto-correct drift; hard-fail on structural problems
validate-pulse-data.js         (recompute freshness/alignment/review flags)
generate-pulse-feed.js         (regen machine feed)
validate-pulse-data.js --check (gate)
generate-pulse-feed.js --check (gate)
open PR + auto-merge            (only reached if all gates passed)
```

Because the gate runs before the commit gates, a STRUCTURAL_FAIL means nothing lands and the page keeps the last verified values.

---

## 2. Cadence + next-release table — `scripts/generate-cadence-table.js`

Generates `data/pulse-cadence.json` (machine) and a human-readable section, listing for all 20 signals:

| Field | Source |
|---|---|
| signal id, name | registry |
| source + series id | registry `source_series` (automated) / "curated" (Tier-2/3) |
| refresh frequency | registry `cadence.refresh_frequency` |
| latest observation date | `pulse-content.json` `last_updated` |
| next expected release | computed from cadence + last observation (best-effort; labeled "approx" for curated/event-driven) |
| verifiable? | automated = "source-verified", curated = "human-curated" |

This is the artifact that answers "how often does each number update, and when is the next one due" — and it is honest about which signals are source-verifiable.

---

## 3. Trigger-freshness fix — `scripts/draft-editorial.js` (+ emit-task)

Today a DRAFT can fire from a material move computed off the last two stored observations even if the latest observation is a month old and unchanged across refreshes (observed: `mfg-activity` 26.7 → -0.4, where -0.4 is the May datapoint and has been stored unchanged for days).

Fix: the trigger additionally requires that the **triggering observation date is newer than the observation date the last DRAFT decision recorded** for that signal. Concretely:

- The decision file records, per triggered signal, the `observation_date` (the `last_updated` of the latest point) that caused the trigger.
- On the next run, a signal only re-triggers a DRAFT if its latest `observation_date` is *strictly newer* than the last recorded triggering observation date for that signal. A move recomputed off the same (already-seen) observation does not re-fire.
- This is a freshness/idempotency guard on the *trigger*, layered on top of the existing content-fingerprint idempotency on the *emit*. It does not change any signal data values, thresholds, or the KEEP/DRAFT math itself — only whether an already-seen observation may re-fire.

---

## 4. 36-month history — `scripts/fetch-pulse-data.js`

The fetcher already pulls ~11 years from FRED/BLS, then trims to `last12`. Change:

- Store **`last36`** (rolling 36 months) in `data_points` for automated signals. (FRED/BLS already return the depth; this is a slice change, not a new fetch.)
- Enrich `compared_to` with: `vs_1mo`, `vs_6mo`, `vs_12mo`, `vs_36mo`, `vs_pre_2020`, plus `range_36mo` = `{ high, low, high_date, low_date, latest_vs_range }` to power "lowest in three years" style statements.
- Validation thresholds updated: `data_points` length floor 12 → require ≥ 24 where source history allows (some series may have <36 months available; handle gracefully with whatever the source provides, never fabricate).
- Curated Tier-2/3 signals: history deepened only where curated data exists; never fabricated to fill 36 slots. Honestly labeled.

This is purely additive to data fields under the existing editorial-preservation guard.

---

## Testing plan (verify, don't claim)

1. `fetch-pulse-data.js --dry-run` — confirm 36-month slice + enriched `compared_to` build without touching live values.
2. `verify-pulse-sources.js` against live FRED/BLS — confirm MATCH for all 10 automated signals on current data (the by-hand check already showed mfg-activity matches: -0.4 / 26.7 = FRED). Capture the verification JSON as proof in the PR.
3. Simulate VALUE_DRIFT (inject a wrong stored value) → confirm auto-correct + log.
4. Simulate STRUCTURAL_FAIL (out-of-range / future date) → confirm hard-fail, no write.
5. Trigger-freshness: replay today's `mfg-activity` (month-old) move → confirm it no longer re-fires a DRAFT; confirm a genuinely new observation still does.
6. Existing gates (`validate --check`, feed `--check`) still pass.

## Rollback

Every change is additive and behind the feature branch. Revert the PR → prior behavior. The verification step can be removed from the workflow with a one-line edit. No data values are destroyed (auto-correct logs old→new).
