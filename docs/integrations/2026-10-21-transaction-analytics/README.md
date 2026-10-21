# Transaction analytics contract capture — 21 October 2026

Package 1 of the [release plan](../../superpowers/plans/2026-10-21-dashboard-transaction-analytics-release-1.md). This directory pins provider evidence and test inputs before schemas, routes or UI change.

## Evidence and existing work

`provenance.json` records the supplied ZIP location, SHA-256 and each vendored file's SHA-256. `provider/` contains byte-for-byte copies of START_HERE, consumer semantics, OpenAPI, production acceptance, the manifest and all examples. Python helpers, smoke scripts and delivery metadata are intentionally excluded; no bundled scripts were executed. The provider manifest includes hashes for those omitted files too.

The six accounts are Annamite, Coincall, DWF and Nickel (Deribit except Coincall), plus Paradex and Paradex-HYPE (Paradex). These are six account examples across three venues. Their IDs are synthetic. Reference summaries and transaction wrappers reconstruct historical evidence; normalization excerpts do not establish prior inventory. They are not live HTTP captures. The provider reports all-six acceptance on 21 October, all with `history_complete=false`; this package does not independently revalidate production or measure latency.

`baseline.json` records the original branch, commit, dirty status and hashes. `baseline.patch` preserves the tracked dashboard edits. The four existing dashboard/helper/test files were preserved byte-for-byte during Package 1. During subsequent branch cleanup they were saved separately in a named Git stash; see VALIDATION.md. Their residual calculation is existing work to reconcile in Package 4, not the definition of the new transaction metric. The originally untracked release plan belongs to the workspace too; only its implementation status/checklist is updated here.

## Field mapping for later implementation

All paths below refer to `provider/analytics_handoff/openapi.json` and the accompanying [consumer semantics](provider/analytics_handoff/README.md). Analytics responses do **not** require `canonical_schema_version` (the separate account-discovery schema has it). Keep additive response fields compatible.

| Source field | Target behavior |
| --- | --- |
| Summary/page `account_id`, optional `venue`; row `account_id`, `venue` | Resolve the authorized mapping server-side on every request. Check envelope identity, every non-null row identity and available venue identity. Never accept an authoritative browser account ID. |
| Summary `group_by`, `groups[].dimensions` | Totals: no optional grouping and no metric filter. Chart: `group_by=day`, gross-profit metric only. Mandatory currency, denomination and quantity-unit partitions survive both. |
| Dimensions `currency`, `denomination`, `quantity_unit` | Local analytics currency selection independent from account reporting currency. Preserve same-currency partitions with differing denomination/unit. Show unknown values explicitly; do not convert or sum incompatible groups. |
| Optional dimensions `day`, `month`, `instrument`, `category` | Retain requested group dimensions. UTC bucket intersection determines drill dates. An absent dimension is not the same as an explicit null partition. |
| `calculated_realized_gross_profit` | Realized trading profit; Before fees and funding. Use the supplied subtotal. Leave category unset to include exercise/delivery. |
| `source_reported_profit` | Comparison context only, separate from calculated gross profit. |
| `net_trading_cost`, `fee_expense`, `rebates` | Trading costs, expense and rebates separately. Positive net cost is expense; negative is net rebate. No closed-trade net-profit inference. |
| `net_funding`, `source_reported_funding` | Verified signed funding; positive received, negative paid, explicit zero valid. Unknown nonzero direction remains unavailable. Source-reported value is details-only comparison. |
| `execution_count`, `executed_quantity` | Execution count and absolute executed quantity with returned quantity unit. Metric component counts are not execution counts. |
| `premium_turnover`, `notional_turnover` | Distinct activity measures in returned monetary partitions; no currency parity assumption. |
| Metric `value` | Exact decimal string or null. Preserve exponent notation such as provider `0E+2`; use existing Decimal.js utilities. Only finite chart coordinates may become numbers. |
| Metric `eligible_count`, `missing_count`, `available_start`, `available_end`, `notes` | Integer component counts and available-value bounds. Partial numeric subtotal must show missing/eligible counts. All eligible missing means unavailable; absent metric means ineligible. Empty groups mean no matching records in available history. |
| `coverage.requested_start`, `requested_end` | Validate against one captured window shared by totals, chart and drawer. Start inclusive; end exclusive. Custom inclusive end dates become the next UTC midnight. |
| `coverage.available_start`, `available_end` | Observed account/instrument bounds before period/additional filters; not proof that requested history is complete. |
| `coverage.derived_status`, `derived_at`, `normalization_version` | Processing state, processing timestamp and available build evidence. Compare metadata across the summary pair and retry a conflict once. Do not synthesize a build token. |
| `coverage.latest_collection_at` | Source collection time when supplied, separate from processing time. |
| `coverage.history_complete`, `notes` | Show History completeness not verified when false, independently of processing or metric availability. |
| `coverage.inventory_status`, `inventory_as_of`, mismatch/unavailable counts | Separate inventory reconciliation status, never a blanket gate on otherwise available metrics. |
| Coverage RFQ counts | Excluded, unmatched and ambiguous source components; never relabel as trade counts. |
| Detail `id`, `event_time`, category/instrument, metrics, `missing_data`, `notes` | Stable identity, UTC time, exact selected metric and unavailable-row explanations. Summary metrics are objects; detail metric values are strings/null. |
| Detail `accounting` (optional/null) | Supplied method/status, quantity/basis/average before and after, opened/closed quantity, execution/settlement inputs, gross profit, comparison, ordering, reconciliation and reason codes. No app-side accounting reconstruction. |
| Detail canonical/source IDs and links | Retain trace provenance, related RFQ and combined source portions. Reconstructed `reference:` endpoints are not actual production routes. |
| Page `next_cursor` | Opaque string/null. Request 50 rows initially; Load more retains exact filters. End only at null. Never splice builds or duplicate row IDs. |

The full metric allowlist also includes settlement/exercise cash-flow and execution-mark metrics. Preserve them in the contract; they are not additional release-1 cards or additions to gross profit. Summary bps, if consumed later, are provider-weighted, never averaged per execution.

## Processing states and unresolved provider semantics

The exact OpenAPI `AnalyticsCoverage.properties.derived_status.enum` is `live`, `pending`, `ready`, `stale`; the schema default is `live`. This confirms **the literal schema value `live`**, not a production observation. START_HERE and the prose describe only three states.

| Value | Display contract |
| --- | --- |
| `pending` | Awaiting processing; do not substitute example/zero values. |
| `stale` | Stale processing; available values may display with that qualification. |
| `ready` | Processing matches checked inputs; financial availability and history remain separate. |
| `live` | **Live processing**. Neutral label pending provider clarification; never infer ready, fresh, complete or certified economics. |

No live deployment behavior for `live` was established in this package. The release plan explicitly allows this neutral treatment, so it does not block Package 2. Publication guarantees also remain an integration check: compare `derived_at` and `normalization_version` when supplied; if usable identity is missing, show that limitation. Two independent responses are not inherently an atomic snapshot.

The reference reason `unwind_transfer_basis_unresolved` means unwind/transfer cost basis remains unresolved. Funding direction and missing execution marks also appear as prose in `missing_data`. Preserve original text/codes in expanded details; unknown codes need a readable fallback rather than omission. No exhaustive reason-code enum is supplied.

## Query and gateway boundary

Shared filters are aware `start`/`end`, exact `instrument`, category, currency, denomination, quantity unit, allowlisted metric and `instrument_is_null`, `currency_is_null`, `quantity_unit_is_null`. A true null flag conflicts with its value filter. There is no denomination-null flag; transaction denomination is a required string. Summary `group_by` is a comma-separated subset of day/month/instrument/category/currency without repeats; the supplied reference examples use day and month together. Detail adds opaque cursor and integer limit 1–200 (default 50). Reject unsupported browser inputs before forwarding.

Use protected `/api/portfolio-data-hub/analytics/{summary,transactions}` routes to the mapped Hub `/api/v1/accounts/{id}/analytics/{summary,transactions}` endpoints, server-side credentials, private/no-store responses. Account discovery in the provider guide is operator guidance; it does not authorize a browser account enumeration route.

Preserve actionable errors: distinguish generic invalid query from cursor/build 400, publication conflict 409, auth/scope 401/403, unknown account 404, invalid inputs/unsupported venue 422, rate limits and transient failures. The prose's blanket retry-on-400 is narrowed by the release plan: only a cursor/build error restarts pagination. Discard the in-progress sequence and restart once, with unchanged filters; only an earlier complete sequence for the identical context may remain marked as previous results.

## Fixture coverage

Every `provider/analytics_handoff/examples/{annamite,coincall,dwf,nickel,paradex,paradex-hype}` directory supplies gross-profit summary/detail plus independent normalization excerpts. Provider `examples/states` adds reconstructed synthetic pending, stale, empty, partial and zero illustrations. None establishes current financial evidence.

Locally authored `synthetic/` fixtures are independent UI scenarios on the synthetic Coincall account, not venue-specific economic claims. Provenance belongs in `synthetic/index.json` and coverage notes, outside wire-shape fields where possible.

| Fixture | Coverage |
| --- | --- |
| `costs-funding-activity.json` | Negative gross profit, separate source comparison, fees/rebates/net cost, funding paid, exact count/quantity, premium and notional turnover. |
| `net-rebate-funding-received.json` | Negative net cost and positive signed funding. |
| `multiple-partitions.json` | USD/USDC separation, same-currency differing denomination and unit, explicit null currency/unit. |
| `partial.json`, `unavailable.json` | Numeric subtotal with missing component; all eligible missing; unknown funding direction while fees remain available. |
| `explicit-zero.json`, `ineligible.json`, `empty.json` | Available zero; absent profit metric; no groups. |
| `pending.json`, `stale.json`, `live.json` | All additional processing states, independent of history and availability. |
| `daily-profit.json` | Selectable explicit zero, partial negative bar and an absent day that must remain a gap. |
| `partial-transactions-page-{1,2}.json` | Two pages, stable synthetic identities/build/window, opaque cursor then null, available and unavailable contributors matching the partial summary. |

Run `npm test -- src/lib/portfolioDataHub/__tests__/analyticsContractFixtures.test.ts` to check source hashes, the six reference identities, required OpenAPI fields, metric allowlists/string values, fixture coverage and the synthetic partial/detail relationship. This capture test is not the additive-compatible production parser planned in Package 2.
