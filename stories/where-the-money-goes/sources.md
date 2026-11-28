# Where the Money Goes — story mode sources

Every figure in this story is taken from Uber's filings and results, as cited below. Arlo and everything he says are made up. "Our math" marks arithmetic done on reported numbers.

## Key sources
- Uber – Q4 and full year 2025 results (Feb 4, 2026) https://investor.uber.com/news-events/news/press-release-details/2026/Uber-Announces-Results-for-Fourth-Quarter-and-Full-Year-2025/default.aspx
- Uber – 2025 annual report income statement (10-K, R5) https://www.sec.gov/Archives/edgar/data/1543151/000154315126000015/R5.htm
- Uber – 2022 annual report (10-K) https://www.sec.gov/Archives/edgar/data/1543151/000154315123000010/uber-20221231.htm
- Uber – 2025 annual report (10-K), tax note and MD&A, for the valuation allowance release https://www.sec.gov/Archives/edgar/data/1543151/000154315126000015/uber-20251231.htm
- SEC XBRL API – Uber accumulated deficit by period https://data.sec.gov/api/xbrl/companyconcept/CIK0001543151/us-gaap/RetainedEarningsAccumulatedDeficit.json

## Step by step: figure, source, check
| Step | Figure shown | Source | Check |
|---|---|---|---|
| 1 | Accumulated deficit **$10.6B at Dec 31, 2025** (down from $32.8B at Dec 31, 2022); 2025 operating profit $5.6B | Uber Q4 and FY2025 results (Feb 4, 2026), balance sheet; SEC XBRL API; Uber 2022 10-K for the $32.8B | Press release balance sheet: accumulated deficit (10,628) $M at Dec 31, 2025 and (20,726) at Dec 31, 2024. SEC XBRL (`RetainedEarningsAccumulatedDeficit`, 10-K filed 2026-02-13, accession 0001543151-26-000015) is -10,628,000,000 for 2025-12-31. 2022: 10-K balance sheet (32,767) $M, shown as $32.8B. Operating income 2025 $5,565M. |
| 2 | Gross bookings $193.5B (2025) | Uber Q4 and FY2025 results | Press release table: Gross Bookings $193,454M. |
| 3 | Revenue $52.0B, 26.9% of $193.5B; the rest "mostly" to drivers, couriers and restaurants | Uber Q4 and FY2025 results | Revenue $52,017M. 52.0 / 193.5 = 26.87%, shown as 26.9% (**our math**). |
| 4 | Cost of revenue $31.3B; "left" $20.7B | Uber 2025 income statement / FY2025 results | Cost of revenue, exclusive of depreciation and amortization, $31,338M. "Left" = 52.0 minus the costs so far (**our math**). |
| 5 | Operations and support 2.9 (left 17.8), sales and marketing 4.9 (12.9), research and development 3.4 (9.5), general and administrative 3.2 (6.3), depreciation and amortization 0.7 (5.6) | same | Press release: 2,854 / 4,898 / 3,402 / 3,241 / 719 ($M). Left amounts are **our math**. 6.3 − 0.7 = 5.6 matches operating income $5,565M. |
| 6 | Operating profit $5.6B = 10.7% of revenue | Uber Q4 and FY2025 results | 5,565 / 52,017 = 10.70%. The story uses Uber's reported 10.7% operating margin. |
| 7 | Net income $10.1B includes a $5.0B one-time tax benefit = 49.5% of $10.1B (**our math**); total tax benefit $4.3B | Uber Q4 and FY2025 results (income statement and footnotes); 2025 10-K tax note and MD&A | 5.0 / 10.1 = 49.5% (5.0 / 10.093 = 49.5%). 10-K: "The income tax benefit was $4.3 billion for the year ended December 31, 2025, which includes a $5.0 billion benefit related to the release of our valuation allowance on the Netherlands' deferred tax assets, partially offset by tax expense on our earnings." Net income for 2025 was $10,093M. |
| 8 | Recap bars: $193.5B, $52.0B (26.9%), $5.6B (10.7%); net income twist | as above | Bar lengths to scale. No new numbers. |

## Our math (all labelled on screen)
- 26.9% = 52.0 / 193.5 (share of gross bookings).
- 49.5% = 5.0 / 10.1 (tax benefit as a share of net income).
- "Still left of revenue" running amounts: 20.7, 17.8, 12.9, 9.5, 6.3, 5.6 (52.0 minus each cost in turn).
