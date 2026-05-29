# ProductSnap Studio Pulse Pass B Handoff

Pass B adds the live-data plumbing layer for Pulse without changing visual design, page architecture, or editorial copy. The frontend still reads `data/pulse-content.json`; the new script refreshes approved numeric/data fields in that file, and the GitHub Actions workflow runs the refresh on a fixed schedule.

## Files added or changed

- `scripts/fetch-pulse-data.js` — Node script that refreshes the approved data fields for the 8 auto-fetched signals.
- `.github/workflows/refresh-pulse-data.yml` — GitHub Actions workflow that runs daily at `0 15 * * *` UTC and commits changed data directly to `main`.
- `js/pulse.js` — small stale-pill cadence tweak only. No visual design or editorial copy changes.
- `data/pulse-content.json` — remains the frontend source of truth. Local testing used dry-run/fallback mode; the first real refresh should happen inside GitHub Actions where secrets exist.

## Data update guardrails

The script only updates these fields for the 8 auto-fetched signals:

- `current_value`
- `data_points`
- `compared_to`
- `percentile`
- `last_updated`

The only intentional exception is `consumer-confidence`, where the source moves from proprietary Conference Board CCI to University of Michigan Consumer Sentiment via FRED. For that signal only, the script may also update:

- `current_unit`
- `source_note`
- `sources`
- `tier`
- `tier_label`

Everything else is protected by an editorial-preservation check. If any non-data/editorial field changes, the script throws before writing.

## Auto-fetched signal map

| Signal | Provider | Series / endpoint |
|---|---|---|
| `cpi-headline` | BLS | `CUUR0000SA0` CPI-U all items; companion `CUUR0000SA0L1E` core CPI fetched for verification context |
| `ppi` | BLS | `WPSFD4` PPI Final Demand |
| `nonfarm-payrolls` | BLS | `CES0000000001` Total Nonfarm, seasonally adjusted |
| `pce` | BEA | NIPA monthly candidate tables `T20804`, `T20304`; script discovers a line whose description contains “excluding food and energy” or “less food and energy” before using it |
| `fed-net-liquidity` | FRED | `WALCL` Federal Reserve total assets |
| `10y-treasury` | FRED | `DGS10` 10-year Treasury constant maturity yield |
| `retail-sales` | Census | `timeseries/eits/marts`, `category_code=44X72`, `data_type_code=SM`, `seasonally_adj=yes` |
| `consumer-confidence` | FRED | `UMCSENT` University of Michigan Consumer Sentiment |

## Hand-curated signals intentionally untouched

- `series-a-counts`
- `ai-model-releases`
- `ai-api-pricing`
- `compute-cost`
- `open-source-ai`
- `emerging-apps`
- `tech-hiring`
- `ai-regulation`

## Local checks completed

- `node --check scripts/fetch-pulse-data.js`
- `node --check js/pulse.js`
- Dry-run output test:
  - `node scripts/fetch-pulse-data.js --dry-run --output tmp-pass-b/pulse-content.dry-run.json`
- Simulated failure test:
  - `node scripts/fetch-pulse-data.js --dry-run --simulate-failure ppi --output tmp-pass-b/pulse-content.failure.json`
- Editorial preservation test:
  - Confirmed dry-run and simulated-failure output only changed approved data/source fields.
  - Confirmed all 8 hand-curated signals stayed byte-equivalent.
  - Confirmed failed `ppi` retained last-known-good data.
- No-change behavior:
  - Running dry-run a second time against the dry-run output produced “No JSON changes.”
- Workflow structure check:
  - Confirmed schedule, secrets, no-change guard, and bot commit message are present.

## Expected GitHub Actions behavior

On each scheduled/manual run:

1. Checkout repo.
2. Run `node scripts/fetch-pulse-data.js` with the four GitHub Secrets.
3. Each signal fetch succeeds or fails independently.
4. Failed signals keep their last-known-good values.
5. If `data/pulse-content.json` changed, commit directly to `main` as `chore(data): refresh pulse signals`.
6. If nothing changed, do not commit.

## Notes before first real run

- Local workspace testing does not use real API keys by design. The first real data population should happen in GitHub Actions.
- BEA core PCE discovery is intentionally defensive: the script validates the line description before using the series. If BEA metadata differs from the expected table/line descriptions, the PCE signal will fail safely and keep its last-known-good value rather than shipping a wrong number.
- Census MARTS requires a valid Census key. The endpoint shape was checked locally and returned a “Missing Key” response, which confirms the endpoint requires the configured secret before returning data.
