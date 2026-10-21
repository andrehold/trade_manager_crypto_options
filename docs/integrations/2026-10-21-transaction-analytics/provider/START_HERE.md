# Target-app handoff: portfolio transaction analytics

Prepared 2026-10-21. Production API acceptance passed for all six accounts using
the operator-provided read-only smoke report. Start implementing against the live
API; keep the known missing-data reasons visible. No baseline configuration or
equity estimate is needed to consume transaction analytics.

## Connection and account selection

**Base URL: `https://hub.germanquantum.tech`**

Send `Authorization: Bearer <data:read API key>` from your application server.
The key must be provided separately through your secret configuration; this
package contains no credentials. The same analytics endpoints cover every venue.

First request:

```http
GET https://hub.germanquantum.tech/api/v1/data/accounts
Authorization: Bearer <server-side key>
```

Discover real account IDs from `items`; store the user's selected account ID and
venue. Do not use the synthetic IDs in the example files or hardcode six IDs.
Support additional returned accounts using the same flow.

| Current account label | Venue |
| --- | --- |
| Annamite | Deribit |
| Coincall | Coincall |
| DWF | Deribit |
| Nickel | Deribit |
| Paradex | Paradex |
| Paradex-HYPE | Paradex |

## Summary, chart and transaction drill-down

Use `GET /api/v1/accounts/{account_id}/analytics/summary` for tables/charts and
`GET /api/v1/accounts/{account_id}/analytics/transactions` for contributing rows.
Both identify account/venue and return coverage/freshness metadata.

Example summary parameters:

```text
start=2026-10-01T00:00:00Z
end=2026-11-01T00:00:00Z
group_by=day,instrument,category
metric=calculated_realized_gross_profit
```

Dates must include a timezone. Start is inclusive; end is exclusive; calendar
buckets are UTC. Do not filter profit to trading only: expiry/delivery can also
realize profit. Omit `metric` to receive every eligible metric.

When a user opens a metric cell, carry its exact instrument, category, currency,
denomination and quantity unit into the detail query. Intersect the cell's UTC
bucket with the original requested period. Preserve the selected metric so rows
with unavailable values are included as contributing context. A null dimension
requires its explicit `instrument_is_null`, `currency_is_null` or
`quantity_unit_is_null` filter. The client helper `drill_filters` implements this
filter/date logic.

Read detail pages until `next_cursor` is null. Keep filters unchanged; `limit`
is 1–200. On a 400/409 cursor/build conflict, discard the partial page set and
restart from page one. Preserve the last complete display while retrying.
The API binds cursors to account, filters and the saved result build.

## Display these Hub-calculated metrics

| UI meaning | API metric(s) |
| --- | --- |
| Realized trading profit before fees/funding | `calculated_realized_gross_profit` |
| Venue's comparison profit | `source_reported_profit` — separate from calculated profit |
| Fees, rebates and trading cost | `fee_expense`, `rebates`, `net_trading_cost` |
| Funding | `net_funding`; `source_reported_funding` is separate comparison data |
| Trade count and quantity | `execution_count`, `executed_quantity` |
| Volume | `premium_turnover` and `notional_turnover` — different measures |
| Execution versus execution-time mark (“spreads”) | `mark_improvement`, `mark_improvement_bps` plus coverage metrics |

The Hub already calculates moving weighted-average cost, long/short closes,
reversals and verified expiry profit. Render the transaction `accounting` trace
for explanation: quantity/basis before and after, opened/closed quantity,
execution/settlement inputs, gross profit, comparison and reason codes. Do not
reconstruct this calculation from raw trades in the target app.

Fees/funding remain independent. Do not subtract all period fees and call it
closed-trade net profit. Display the supplied weighted summary bps; never average
individual execution bps. Positive mark improvement is favorable, before fees.

## Values, partitions and availability

- Preserve monetary/quantity values as exact decimal strings. `"0"` is available
  zero; null is unavailable; an absent metric is ineligible.
- Show `missing_count`, `eligible_count` and notes next to an incomplete subtotal.
  Do not turn missing profit into zero or suppress supported fees/volume with it.
- `coverage.derived_status` is `pending`, `stale` or `ready`. Label stale values;
  ready means processing matches checked inputs, not that every metric is known.
- Display `history_complete` and inventory limitations separately from processing
  freshness. All six accounts currently retain `history_complete=false`.
- Keep account/venue/currency/denomination/unit partitions separate. USD, USDC,
  USDT and BTC are distinct; no parity or historical FX conversion is assumed.
- There is no cross-account aggregate endpoint in this contract. Display each
  account's groups; request a Hub extension if a consolidated financial measure
  is required instead of implementing new accounting/FX logic in the app.

Gross realized trade profit and total account return are different measures.
The app may choose how to display a reconciliation difference, but the current
analytics API supplies no verified “miscellaneous return” field. Do not silently
relabel a difference as earned profit or force the measures to match. Account
returns can also reflect open-position valuation, fees/funding and other effects;
deposits/withdrawals are capital flows rather than returns.

Known gaps: Nickel spot BTC cash cost basis; Paradex unwind cost/realization and
USD/USDC settlement conversion; missing execution marks; unresolved nonzero
funding direction; and uncertified archive completeness. Preserve per-result
reasons. No estimate of their total impact has been certified.

## Package contents and provenance

Open `analytics_handoff/APP_GUIDE.md` for the implementation checklist, then
`analytics_handoff/README.md` for complete semantics and filters. Import
`analytics_handoff/openapi.json` into your tooling. A standard-library Python
client and read-only acceptance smoke are included; other languages can consume
the same HTTP/JSON contract directly.

`examples/` contains all-six-account response shapes reconstructed from approved
historical financial traces, independent normalized source excerpts and separately
labeled synthetic UI states. They are not verbatim live HTTP captures. Identifiers
are synthetic; some routing/clock context is explicitly reconstructed or absent.
Use them for schema/display integration; get current data/IDs from the API.

`analytics_handoff/production-acceptance.json` records the operator-provided
2026-10-21 run: all six builds ready, 13,716 detail rows, 139,362 successful
summary/detail metric checks, and 8,506 rows with available calculated profit.
This does not certify complete venue history or measure deployed latency.

From this extracted directory, run the acceptance smoke after securely setting
`PDH_API_KEY` in your environment:

```bash
python3 -m analytics_handoff.analytics_smoke --base-url https://hub.germanquantum.tech --expected-accounts 6
```

It checks authentication rejection, every supported enabled account, readiness,
full detail pagination, period/day/month agreement, weighted marks and available
calculated profit. It is read-only and prints counts/status rather than keys or
transactions. An empty/narrow period with no available calculated profit is not
accepted as a successful financial validation.

## App implementation acceptance

Select each discovered account and verify its account/venue identity. Match a
period/day/month cell to all of its contributing pages, including partial/null
cases and exact null partitions. Confirm that all required units and freshness
states are visible. Exercise a 400/409 restart without duplicating rows. Keep the
API key server-side and confirm that no cost-basis or mark-comparison calculation
has been added to the app.
