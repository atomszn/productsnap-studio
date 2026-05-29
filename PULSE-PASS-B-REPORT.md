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

## Pass B.1 hotfix

Targeted follow-up to the first GitHub-Actions-refreshed JSON. No visual, architectural, or editorial changes; only `scripts/fetch-pulse-data.js`.

1. Daily/weekly FRED signals (`10y-treasury`, `fed-net-liquidity`) now use the latest **raw** observation date and value for `current_value` and `last_updated`. The 12-point monthly sparkline (`data_points`) is unchanged. Controlled by a per-signal `latestFromRaw` flag so monthly signals stay month-aligned.
2. Tone is now per-signal via a `TONE_POLICY` map. Previously every "up" was painted amber; that misread series where direction reverses interpretation. Policy:
   - `up_bad` (higher is amber): `cpi-headline`, `ppi`, `pce`, `10y-treasury`
   - `up_good` (higher is green): `fed-net-liquidity`, `consumer-confidence`, `retail-sales`, `nonfarm-payrolls`
3. BEA and Census paths now emit diagnostic context on failure: BEA's 200-OK error envelopes (`BEAAPI.Results[].Error` and `BEAAPI.Error`) are surfaced as real errors; line discovery reports which candidate tables were tried and how many lines each returned; Census reports dataset/category context and header columns when the response shape is wrong. All failures still fall through to last-known-good data.

Guardrails are unchanged: only approved data/source fields are mutated; the `assertEditorialPreserved` check still runs before write; hand-curated signals are untouched; the dry-run path needs no secrets.
