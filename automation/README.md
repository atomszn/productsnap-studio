# Pulse Editorial Automation — Phase 1 (Research Agent, Shadow Mode)

This directory is the control plane for the ProductSnap Pulse editorial automation.
**Phase 1 is research SHADOW MODE only:** the AI research agent produces reviewable,
sourced findings on every DRAFT event. It publishes nothing, merges nothing, and
never touches live Pulse content or data.

## Two-world design (why GitHub stays dependency-free)

```
  GitHub Actions pipeline (deterministic, Node built-ins only, NO AI, NO npm)
  ─────────────────────────────────────────────────────────────────────────
  fetch-pulse-data → validate → draft-editorial.js ──► writes data/pulse-editorial-task.json
                                     (phase>=1)              (typed handoff file)
                                                                    │  polled seam
  Perplexity Computer (the ONLY place AI runs)                      ▼
  ─────────────────────────────────────────────  automation/research-runner.js --prep
                                                  → AI research agent (per prompts/research.md)
                                                  → research-runner.js --ingest <findings>
                                                       ├─ validates against schema (refuses bad)
                                                       ├─ writes data/pulse-research-findings.json
                                                       ├─ writes automation/runs/<date>-<run>.json
                                                       └─ appends automation/spend-ledger.json
```

The factual data refresh (fetch/validate/feed) is a **separate pipeline** and is
never affected by any AI failure, budget state, or kill switch here.

## Files

| File | Purpose |
|------|---------|
| `automation-config.json` | Master switches: phase (0–4 kill switch), shadow_mode, auto_publish, confidence threshold, budget block, exit criteria, notification policy, file paths. |
| `model-registry.json` | Provider-agnostic role→model routing (research/editorial/validation) with conservative per-run cost estimates. Change models here without touching code. |
| `spend-ledger.json` | Append-only cost audit trail. One entry per AI run. |
| `schemas/*.json` | Typed contracts for the task, findings, and run-record artifacts. |
| `prompts/research.md` | The research agent's contract and hard rules. |
| `research-runner.js` | Computer-side orchestrator (`--prep` / `--ingest`). Not invoked by GitHub. |
| `runs/<date>-<run_id>.json` | Immutable per-run audit record. |

| Script (in `../scripts`) | Purpose |
|------|---------|
| `emit-editorial-task.js` | Writes the typed handoff task on a DRAFT (phase>=1). Schema-validated; idempotent via content fingerprint. |
| `check-budget.js` | Budget governor. proceed / downgrade (≥70% of cap) / stop (≥100%). Read-only/advisory in Phase 1. |
| `lib/schema-validate.js` | Dependency-free JSON-Schema-subset validator. |

## Budget

`monthly_target_usd: 50` (design target) · `hard_cap_usd: 100` (absolute) ·
`downgrade_at_pct: 70` · `stop_drafting_at_pct: 100`. At the hard cap, drafting
stops but factual data refresh continues.

## Phase 1 exit

First of: **5 real DRAFT events** OR **14 days**. Then review findings quality
and decide whether to proceed to Phase 2 (editorial rewrite + validation gate).

## Safety invariants

- Phase 0 behavior is byte-for-byte the pre-automation log-only path.
- AI cannot break factual data refreshes (separate pipeline, no shared failure path).
- Findings that fail schema validation are refused — never written.
- Idempotent: a fingerprint that already has findings is never re-researched.
- Never changes: signal data values, app store links, trust gates, workflows.
