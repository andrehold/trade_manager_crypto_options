# Dashboard transaction analytics first release implementation plan

Status: Packages 1–3 completed on 2026-10-21; Packages 4–5 completed on 2026-10-22. Package 6 implementation and available validation performed on 2026-10-22; final release sign-off is pending the remaining live portal/runtime checks documented below.

Package 1 capture: [contract mapping, provenance and fixture coverage](../../integrations/2026-10-21-transaction-analytics/README.md), with [validation results](../../integrations/2026-10-21-transaction-analytics/VALIDATION.md). Existing dashboard work is preserved. The documented schema value `live` uses the neutral Live processing label pending provider clarification; production publication semantics remain an integration check.

Package 2: [schemas, protected routes, error contract and validation](../../integrations/2026-10-21-transaction-analytics/PACKAGE-2.md). The account-isolation/filter/error/parsing gate passed; live production validation remains outstanding.

Package 3: [authenticated client, mounted state, consistency/recovery and validation](../../integrations/2026-10-21-transaction-analytics/PACKAGE-3.md). The hook race/identity/isolation/retention gate passed.

Package 4: [trading presentation, dashboard integration and validation](../../integrations/2026-10-21-transaction-analytics/PACKAGE-4.md). The component/dashboard metric/partition/isolation gate passed.

Package 5: [contributing transactions, exact drill scope, pagination recovery and validation](../../integrations/2026-10-21-transaction-analytics/PACKAGE-5.md). The fixture-backed detail/context/pagination gate passed. Unsupported null-denomination scoping and missing build evidence remain explicit service limitations.

Package 6: [final validation, measured analytics timeout, live evidence and rollout gate](../../integrations/2026-10-21-transaction-analytics/PACKAGE-6.md). Independent full-history Hub acceptance passed for all six accounts; 56 application cells reconciled through 75 pages; actual authenticated portal coverage passed for Paradex. Five mapped client-session checks and deployed portal/runtime verification remain open. The release gate is not signed off; deployment is a separate action.

Add transaction-based realized gross profit, trading costs, verified funding and trading activity to the live client dashboard. Clients should be able to select a period, see the limitations of each result and inspect the contributing transactions without losing the current account overview.

## Scope and product decisions

| Surface | First release behavior |
| --- | --- |
| Current account overview | Keep equity, unrealized P&L, open positions, balance and available funds on their existing snapshot sources. Clearly label these values Current. |
| Realized profit KPI | Replace the dashboard's calculated net realized residual with Realized trading profit, qualified Before fees and funding. Use the Hub's calculated_realized_gross_profit for the selected period. |
| Realized profit chart | Replace the venue snapshot realized-P&L trend with daily gross-profit bars in the trading section. Each bar opens contributing transactions. |
| Trading costs card | Show net_trading_cost with fee_expense and rebates as separately labelled details. Positive means expense; negative net cost means net rebate. |
| Funding card | Show verified signed net_funding. Label received or paid where known. Missing direction remains unavailable. Source-reported funding is comparison context in details only. |
| Trading activity card | Show execution_count, executed_quantity, premium_turnover and notional_turnover as distinct measures with their returned units. |
| Coverage | Show processing state, processing time, source collection time when supplied, missing components and source-history limitations. |
| Transaction drawer | Open from each eligible metric and profit bar, preserving metric, date window and exact dimensions. Include a paginated table and expandable accounting explanation. |

Keep lifetime account performance, current equity/unrealized trends, risk, native positions and ledger history. Place trading results in their own section after the account overview. Move the existing realized-profit tile into that section rather than displaying two differently defined realized-profit KPIs. Remove only the realizedPnl series from HubPerformanceTrends; retain equity and unrealizedPnl. Their existing last-30-days scope remains explicit and independent of the trading period.

Execution quality, instrument attribution, realization-category charts, consolidated accounts, return percentages, strategy attribution and a net closed-trade profit calculation are outside this release. No database migration or new account selector is planned; reuse the existing authenticated client-to-Hub account mapping.

## Period and partition controls

- Default to month to date in UTC. Also offer last 30 days and a custom date range.
- Month to date runs from the first day at 00:00 UTC to a captured request time. Last 30 days uses the preceding 30 times 24 hours through that same captured time.
- Custom dates represent inclusive calendar dates in UTC; convert the final date to the following midnight for the API's exclusive end. Validate the range before requesting data.
- Capture one start/end pair for totals, chart and drawer. Manual refresh advances the end for relative presets; opening details does not silently advance it.
- Label the control Trading period and display UTC. It does not change current account values, lifetime performance or the independent snapshot charts.
- Fetch the account's analytics without filtering to the existing account currency. Analytics must remain available when that currency is unselected, absent from analytics or unavailable in account snapshots.
- Use a separate local analytics currency selector populated from returned groups. Prefer the account currency if present, otherwise the only returned currency. If several exist with no match, require an analytics currency choice and show the available choices. This selection does not write reporting_currency.
- Preserve denomination and quantity_unit within each currency. Render multiple labelled values or subrows where partitions differ; do not combine groups just because their currency matches. Display unknown dimensions explicitly.
- Remember period/analytics partition selections within the mounted dashboard only. Do not add persistence in this release.

## Financial and display contract

Use the supplied exact-decimal values and existing Decimal.js utilities. Transport and retain amounts, quantities and bps as strings. Metric values distinguish available zero, unavailable null and absent/ineligible metrics. Counts of missing/eligible components are not execution counts and must not be presented as trade counts.

Keep calculated profit separate from source_reported_profit. Fees, funding and settlement/exercise cash flows are independent measures. Do not reconstruct cost basis, calculate realized profit locally, subtract all period fees to claim closed-trade net profit, assume stablecoin parity or convert between monetary partitions. Profit requests leave category unset so exercise and delivery remain included.

For each metric, show a partial subtotal with missing_count and eligible_count, or unavailable when all eligible values are missing. A partial indicator must accompany the amount and appear in chart tooltips. Empty groups mean no matching records in available history, not a certified zero. Do not fill absent days with fabricated zero profit; show gaps/no reported activity. Explicit zero bars remain selectable through an accessible table or day list.

Ready refers to processing, not complete economics. Keep history_complete=false visible as History completeness not verified. Show pending and stale separately from metric availability and inventory status. Known reason codes get plain-language explanations; retain the original code in expanded details, including a readable fallback for new codes.

Only chart coordinates may use finite JavaScript numbers. Preserve exact strings for amounts, tooltips and the accessible data table. Unrepresentable chart coordinates remain unavailable on the plot while the exact value remains readable in the table.

## Data architecture

Browser -> protected portal analytics routes -> existing authenticated mapping -> Hub account analytics endpoints.

Add these read-only routes using the existing edge handler conventions:

- /api/portfolio-data-hub/analytics/summary proxies the selected account's analytics/summary.
- /api/portfolio-data-hub/analytics/transactions proxies the selected account's analytics/transactions.

The browser supplies filters, never an authoritative Hub account ID. Resolve the account on the server for every request. Verify response account identity, including non-null row account IDs, and venue consistency where available. Keep the Hub key server-side and use private, no-store responses. Account discovery remains an operator concern rather than a client-facing list of all accounts.

Load two summaries for one captured period:

1. Period totals with no optional grouping and no metric filter, retaining the API's mandatory currency, denomination and quantity-unit partitions.
2. Daily gross profit with group_by=day and metric=calculated_realized_gross_profit.

Commit the pair to the UI together after validating account, venue, requested window and available build metadata. Compare derived_at and normalization_version when supplied; mismatches trigger a bounded retry of the pair. These fields are the available consistency evidence, not a new guaranteed build token. Confirm actual publication semantics during integration; if ready responses lack usable build identity, surface that limitation rather than inventing transactional guarantees. Never sum the chart to manufacture period totals.

Transactions are requested on demand, initially 50 rows per page. Retain filter/metric context and follow next_cursor until null through Load more. Do not download all account transactions when opening the dashboard. No polling or focus refresh in this release; use initial load, explicit period changes and manual refresh.

## Work packages and dependency gates

### 1 Capture the contract and protect existing work

- Record the working-tree baseline. Existing uncommitted changes in HubPortfolioView, its tests and the realizedPnl module/tests belong to the current workspace and must be reconciled rather than overwritten.
- Vendor the supplied OpenAPI, consumer semantics and relevant fixtures under a dated docs/integrations transaction-analytics directory. Keep reconstructed fixtures clearly labelled and use synthetic account IDs.
- Add focused fixtures for all six venues/accounts, multiple partitions, fees/funding/activity, pending, stale, partial, explicit zero, ineligible and empty states. Existing per-account summary examples cover gross profit only; supplement them with clearly synthetic UI fixtures for other metrics.
- Confirm the OpenAPI derived_status value live, which is absent from the prose's three-state list. Accept the schema value without equating it to certified ready/current results; define a neutral Live processing label pending clarification.

Gate: documented field mapping and representative fixture coverage before UI implementation.

### 2 Add schemas and protected server routes

Primary files: src/lib/portfolioDataHub/analyticsSchemas.ts, analyticsNormalizers.ts, server.ts, index.ts and the two new api/portfolio-data-hub/analytics route files.

- Define additive-compatible Zod schemas for summaries, metrics, dimensions, coverage, transactions and accounting traces. Reuse ExactDecimal semantics; do not require a canonical_schema_version field absent from the analytics contract.
- Validate all supported query filters, metric allowlist, grouping combinations, aware dates, date ordering, mutually exclusive value/null filters and detail limit 1 through 200. Reject unsupported query inputs before forwarding.
- Preserve explicit null filters, opaque cursors, exact units and error meaning.
- Add distinct analytics error codes for invalid query, invalid cursor/build and publication conflict. The generic existing fetchHub helper collapses upstream failures to 502; adapt analytics handling so 400/409 remain actionable. Do not change unrelated route behavior.
- Preserve 401/403, 404, 422, rate limiting and transient failure behavior in useful portal errors without exposing credentials or raw upstream bodies.

Gate: route tests prove account isolation, filter forwarding, error handling and valid response parsing.

### 3 Add analytics client and state management

Primary files: src/lib/portfolioDataHub/analyticsClient.ts and src/features/clientPortal/usePortfolioHubAnalytics.ts, with a separate detail hook if needed.

- Provide typed summary/detail requests and filter types, using existing Supabase authentication.
- Keep analytics loading/failure independent from overview and lifetime performance. A summary or positions failure must not automatically prevent otherwise authorized analytics from loading, and vice versa. Mount analytics at the client dashboard boundary rather than only inside the hubState ready branch.
- Key requests and retained values by signed-in user, client, mapped account, exact period and filters. Clear on logout, identity change or mapping change. Ignore late responses from old generations.
- Preserve the last completed pair while refreshing the identical context, with a refresh-failed notice when needed. On period/filter changes, never display old values under new labels.
- Retry a detected publication conflict once automatically; after a second conflict, show a manual retry action. Do not loop indefinitely.
- Keep pending processing as a distinct state without substituting example or fallback values.

Gate: hook tests cover request races, identity switches, independent failures, consistency checks and refresh retention.

### 4 Build the trading section and integrate the dashboard

Primary files: new components/analytics/TradingAnalyticsSection.tsx, AnalyticsPeriodControl.tsx, AnalyticsCoverage.tsx, TradingCostsCard.tsx, FundingCard.tsx, TradingActivityCard.tsx and RealizedProfitChart.tsx; existing HubPortfolioView.tsx, charts/HubPerformanceTrends.tsx and ClientPortalShell.tsx.

- Implement the agreed layout and metric labels using current UI primitives, typography, theme tokens and responsive patterns.
- Display supplied gross-profit totals; remove the account residual from the headline dashboard presentation. Retain or remove the old helper only after checking references and reconciling existing uncommitted work.
- Add exact-value tooltips, positive/negative daily bars, partial markers and keyboard-accessible day details.
- Place the analytics controls and coverage directly beside the trading results they qualify. Preserve existing account currency behavior for snapshot cards.
- Show the trading section independently when lifetime performance is unconfigured or analytics has additional currencies. Never replace a failed live analytics result with illustrative data.

Gate: component and dashboard tests prove correct metric selection, labels, partitions and loading/error isolation.

### 5 Add contributing transaction details

Primary files: components/analytics/AnalyticsTransactionDrawer.tsx, AnalyticsTransactionTable.tsx, AccountingTrace.tsx and dashboard/analyticsDrillFilters.ts.

- Construct filters from the originating group, selected metric and original period. Intersect day/month UTC buckets with that period. Preserve currency, denomination and quantity unit, with explicit null-only filters where supported. Keep all originally applied filters.
- Include eligible rows with unavailable values so missing components can be explained.
- Show time, instrument, category, selected metric, units and missing reasons. Expand rows to show relevant Hub accounting fields, including basis/quantity before and after, opened/closed quantity and comparison context. No app-side accounting.
- Load more with unchanged filters, keeping stable row identities and detecting duplicates or unexpected response identity changes.
- On a cursor/build-related 400 or publication 409, discard the in-progress page sequence and restart at page one once. A generic 400 validation error must not cause blind retries. Preserve only a previously completed full sequence for the identical context, marked as previous results; otherwise show a restarting state. Never splice builds.
- Coordinate summary refresh and drawer restart when the originating summary belongs to an older build. Do not claim that a changing-build detail set reconciles to the old cell.
- Provide focus trapping, Escape close, focus restoration, readable narrow-screen layout and clear end-of-results state.

Gate: a summary cell can be traced to all its detail pages with exact filters and no duplicate or mixed-build rows.

### 6 Validate and prepare rollout

- Run focused contract, gateway, hook and component tests as each work package lands.
- At integration completion, run the full test suite, npm run typecheck and npm run build. Investigate failures against the recorded baseline.
- Verify desktop and mobile layouts, keyboard navigation, zero bars, negative profit, long decimals, multiple partitions and unavailable metrics.
- Run the supplied read-only acceptance smoke and portal integration checks against each of the six configured accounts when authenticated access is available. Use actual discovered IDs through authorized mappings; reconstructed examples are display fixtures, not current financial evidence.
- Match selected period/day/metric cells against complete transaction pagination, including null partitions and partial results. Exercise rebuild conflicts through controlled fixtures if production cannot reproduce them safely.
- Measure real summary/detail response sizes and latency. Set timeouts from measured behavior; paginate detail rather than adding broad polling or loading full histories.
- Record production account/history limitations, test outcomes and any remaining live-validation gaps before release sign-off. Deploy only as a separate release action.

Gate: all completion criteria below pass, with live validation explicitly recorded.

## Completion criteria

1. The realized-profit KPI and daily chart use the same gross trading-profit definition and exact selected period.
2. Trading costs, verified funding and execution activity are displayed from Hub metrics with their actual partitions and units.
3. The trading section loads without a configured lifetime baseline, account-currency choice or successful snapshot request, provided authentication and account mapping are valid.
4. Zero, partial, unavailable, ineligible, empty, pending and stale results remain distinguishable.
5. Every displayed eligible metric opens correctly scoped transaction details, including unavailable contributing rows and null dimensions.
6. Pagination continues to completion and rebuild conflicts recover without duplication or combining saved builds.
7. No account enumeration, credential exposure or arbitrary browser-selected Hub account access is introduced.
8. Equity, open P&L, lifetime performance, risk, positions and ledger retain their existing sources and behavior.
9. The existing account residual and venue-snapshot realized trend no longer appear as though they measure the new gross trading profit.
10. No cost-basis reconstruction, FX assumptions, cross-partition totals or claimed closed-trade net profit is added.

## Inputs and provenance

- Handoff: /Users/andreholschick/Desktop/portfolio-data-hub/dist/trade-analytics-target-app-handoff-2026-10-21.zip, especially START_HERE.md, analytics_handoff/README.md, openapi.json and production-acceptance.json.
- The handoff reports all-six-account acceptance on 21 October 2026, based on operator-provided output. All six report history_complete=false; deployed latency is unmeasured.
- Handoff instructions describe the provider contract. This plan authorizes no Hub deployment, migration, worker configuration change or execution of bundled scripts merely because those actions appear in the handoff.
