# Transaction analytics consumer contract

Implementation contract for all configured Coincall, Deribit and Paradex accounts.
**Authenticated production API acceptance passed for all six accounts on
2026-10-21**, based on the operator-provided report in `production-acceptance.json`.
Known per-result financial gaps and uncertified source history remain explicit. The portfolio app displays Hub results; it does not calculate cost
basis, realized profit or mark comparisons. No equity estimate or baseline setup
is required. The legacy `/analytics/realized-estimate` is a separate resource.

Give the app team the complete `consumer_kit/analytics_handoff` directory. Start with `APP_GUIDE.md`. It
contains a standalone [OpenAPI schema](openapi.json), this guide,
a server-side Python client, an acceptance smoke tool and six-account reference
examples. The canonical ingestion handoff remains a separate package.

## Select an account and request results

Use the existing `data:read` bearer key server-side. Keep keys out of browser code,
URLs and logs. `GET /api/v1/data/accounts` supplies account ID, label, venue and
enabled status. Select any configured supported account; the six current labels
are Annamite, Coincall, DWF, Nickel, Paradex and Paradex-HYPE. Example account IDs
are synthetic and cannot be used against production. Key scopes authorize the API;
client-to-Hub account mapping remains the consuming application's responsibility.

```text
GET /api/v1/accounts/{account_id}/analytics/summary
GET /api/v1/accounts/{account_id}/analytics/transactions
Authorization: Bearer <server-side data:read key>
```

Both responses identify account and venue. This is an account-scoped contract;
keep account/venue and monetary/unit partitions separate when displaying multiple
accounts. No cross-account aggregate or historical FX conversion is supplied.
Canonical ledger/raw records and their authenticated drill-down APIs are preserved.

| Shared filter | Meaning |
| --- | --- |
| `start`, `end` | Aware ISO timestamps, normalized to UTC; start inclusive, end exclusive. Omit for open bounds. Start must precede end. |
| `instrument` | Exact native instrument ID. |
| `category` | `trading`, `funding`, `exercise`, `delivery`, `withdrawal`, `other`, `rfq_review`, `transfer`, `bookkeeping`, `balance_cost`, `unsupported`. |
| `currency`, `denomination`, `quantity_unit` | Exact returned partition values. USD, USDC, USDT and BTC are distinct. |
| `instrument_is_null`, `currency_is_null`, `quantity_unit_is_null` | Select an exact null partition. Default false. A true null filter and its value filter cannot be combined. |
| `metric` | Allowlisted name from OpenAPI. Includes eligible rows with null values, excludes ineligible rows. Summary returns only that metric; detail retains row context. |

Summary `group_by` is a comma-separated subset of `day,month,instrument,category,currency`,
without repeats. Day/month boundaries are UTC. Currency, denomination and quantity
unit are always retained. Never flatten incompatible groups into one total.
Do not default profit requests to `category=trading`: expiry/exercise/delivery
can also realize profit.

## Display values and coverage

All amounts, quantities, counts and bps are exact decimal strings or null. Preserve
strings through transport and use decimal-aware presentation. Explicit `"0"` is
available zero. Null is unavailable; an absent metric is not eligible. Empty groups
mean no selected rows, not certified zero activity.

Each metric includes `value`, `eligible_count`, `missing_count`, available-value
dates and notes. Counts describe eligible result components, not necessarily
executions. Available values can form a numeric partial subtotal with a nonzero
missing count. Display the subtotal with its incompleteness, or an unavailable
state when every eligible value is missing. A missing mark or reported profit
does not suppress an independently known fee or calculated profit.

| Metric family | Interpretation |
| --- | --- |
| `calculated_realized_gross_profit` | Moving weighted-average realized profit from the account's confirmed empty start, before fees/funding. Long/short partial/full closes, reversals and verified expiry payoffs consume prior basis. Opening/increasing rows can have available zero. |
| `source_reported_profit` | Separate venue comparison. Never substitute it for calculated profit or add the two. Comparisons require the same currency/units. |
| `execution_count`, `executed_quantity` | Unique economic executions and absolute quantity in the returned verified unit. RFQ duplicates, settlement/unwind fills and fee components do not inflate traded execution totals. |
| `premium_turnover`, `notional_turnover` | Option premium versus underlying/spot notional, in their verified native partitions. Both entry and exit executions count. |
| `fee_expense`, `rebates`, `net_trading_cost` | Positive cost, positive rebate, and trading expense minus rebate. Entry-fee allocation to closed trades is not supplied. Do not subtract all period fees and label the result closed-trade net profit. |
| `source_reported_funding`, `net_funding` | Native comparison versus verified signed funding. Unresolved nonzero direction remains null with a reason; explicit zero is valid. |
| `mark_improvement` | Execution versus execution-time mark, before fees: favorable buy/ sell improvement is positive. A current position mark or underlying price is not a replacement. |
| `mark_value_turnover`, `mark_improvement_bps` | Covered execution mark value; summary bps are 10,000 × summed covered improvement / summed covered mark value. Never average row bps. |
| `mark_eligible_turnover`, `mark_covered_turnover` | Supported premium turnover versus the part with usable execution marks. Coverage and missing amounts remain visible. |
| Settlement/exercise cash-flow metrics | Native inspection/comparison fields. Opening, settlement and net cash flows overlap; never add them to calculated realized profit. |

Transaction `accounting` exposes method/status, signed quantity, total remaining
basis and average price before/after, opened/closed quantities, execution and
verified settlement inputs, gross profit, same-partition source comparison,
ordering evidence, reconciliation, notes and reason codes. Null basis remains
unknown until supported data establishes fresh inventory. Source event/batch IDs
link actual responses to canonical/raw provenance; related RFQs and combined
Deribit portions remain source links. Fees/USDC comparison components may be
separate rows from a USD quoted-price execution, with no duplicate count/volume.

Known gaps remain explicit: Nickel spot BTC cash basis, Paradex unwind basis and
realization, USD/USDC settlement conversion/history, missing Paradex execution
marks, nonzero funding direction and uncertified archive coverage. Do not assume
parity, invent cost basis or replace a missing value with zero.

## Freshness, stable pagination and errors

`coverage.derived_status` describes saved input processing:

- `pending`: no built results yet; retain an awaiting-processing state.
- `stale`: stored results lag ledger/snapshot inputs or calculation version.
  Values can still be displayed as stale; do not label them current.
- `ready`: the saved build matches checked inputs. This does not certify complete
  source history or availability of every financial metric.

`derived_at` and `normalization_version` identify the saved build. Latest source
collection time is separate. `inventory_status` reports aligned position checks;
missing position snapshots do not gate otherwise supported profit. Observed bounds
are for the account/exact instrument before period and additional filters.
`history_complete=false` must remain visible as a source-coverage limitation.

Detail uses `limit=1..200` (default 50) and opaque `next_cursor`; rows sort descending
by effective timestamp and UUID. Continue until `next_cursor=null`, preserving
all shared filters. Cursors bind account, filters and saved build. Changing page
size is allowed. A rebuild invalidates older cursors, even when amounts are unchanged.
Never splice pages from different builds. Preserve the last complete response
while discarding partial pages and restarting after a cursor/build conflict.

| HTTP status | Action |
| --- | --- |
| 400 | Malformed cursor, changed filters/account, or previous saved build: restart from the first page. |
| 401 / 403 | Missing/invalid key or missing `data:read`; correct server-side credentials/scopes. |
| 404 | Unknown account. |
| 409 | A publication crossed this multi-query read: discard the request/page set and retry from the first page. |
| 422 | Unsupported venue, naive/invalid dates, invalid grouping/metric, or conflicting value/null filters. |

## Open a summary cell

Carry every returned dimension into detail filters, including explicit null-only
filters. Intersect the cell's UTC day/month interval with the original requested
period. Keep the selected metric so unavailable contributing rows are included.
The portable `drill_filters` helper performs only filter/date construction.

```python
from consumer_kit.analytics_client import AnalyticsClient, drill_filters

client = AnalyticsClient(base_url=hub_url, api_key=server_side_key)
filters = {"start": "2026-10-01T00:00:00Z", "end": "2026-11-01T00:00:00Z",
           "metric": "calculated_realized_gross_profit"}
summary = client.summary(account_id, filters, "day,instrument,category")
# Render each group/metric, units, freshness, missing counts and notes.
cell = summary["groups"][0]
rows = client.transactions(account_id, drill_filters(filters, cell["dimensions"]))
# Render the returned metrics and accounting trace; no cost calculation in the app.
```

In a copied portable package, import `analytics_handoff.analytics_client` instead.
Read all six accounts individually for a multi-account display; keep partitions.

## Reference examples and rollout checks

The bundle's examples are reconstructed response shapes from approved local
2026-10-19 source excerpts and 2026-10-20 validated historical profit traces.
They are not new production exports or authenticated live HTTP captures.
Identifiers are synthetic. Trace wrappers use `category=other` and a `reference:`
endpoint where the stored evidence omitted original routing context; missing
canonical fields are null. These wrappers demonstrate values/trace shapes rather
than source routing. Paradex-HYPE's unavailable example has a synthetic clock
because its source excerpt lacks a timestamp. `normalization-excerpts.json`
provides independent venue fee/mark/currency examples with synthetic clocks;
these standalone excerpts do not establish prior inventory or profit.
`examples/states` contains separately labeled synthetic pending/stale/empty/partial/zero
UI illustrations; those are not observed account responses.

The historical normalization-version string in a reference response is provenance,
not a value the app should hardcode. Ready in these fixtures describes the example
build, not deployment. Consult the manifest before treating an example as evidence.
Regenerate locally without network/DB access:

```text
python -m consumer_kit.build_analytics_handoff --write
python -m consumer_kit.build_analytics_handoff --check
```

After separately authorized deployment, apply migrations through 0023 and opt in
the existing worker with `TRANSACTION_ANALYTICS_PROCESSING_ENABLED=true`. Observe
all six initial builds and subsequent turns before public acceptance. Run the
read-only acceptance tool using a server-side environment key:

```text
PDH_API_KEY=<set securely in environment>
python -m consumer_kit.analytics_smoke --base-url https://your-hub --expected-accounts 6
```

The portable equivalent is `python -m analytics_handoff.analytics_smoke` from its
parent directory. Default acceptance reads full observed history; optional
`--start`/`--end` narrow it. A window with no available calculated profit fails
explicitly so an empty period cannot masquerade as validation. The tool checks
missing/invalid auth, all supported enabled accounts, readiness, complete detail
pagination, period/day/month summary agreement, coverage and weighted mark bps.
It reports counts/status only. Validator arithmetic uses 80-digit Decimal and a
1e-60 tolerance for final working-digit summation differences; the app itself
uses Hub metrics. A changed build requires restarting the smoke check.

The existing production smoke script can opt into the same acceptance via
`PDH_SMOKE_ALL_VENUE_ANALYTICS=1`. Its normal behavior stays compatible. No new
public path or gateway rule is required. Production acceptance passed on 2026-10-21
from the operator-provided smoke report. Deployed query latency was not measured.
The historical response examples remain reconstructed fixtures, not live captures.
