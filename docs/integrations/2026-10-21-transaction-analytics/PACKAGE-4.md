# Package 4 — trading results presentation

Completed 22 October 2026 on `feat/transaction-analytics-dashboard`, based on merged Package 3 PR #160 (`6fa9428676934eb2fb9c22927d2b4f810bd73b5f`).

## Dashboard integration and existing work

The live dashboard renders a separate Trading results section immediately after the current account overview, before the independent snapshot trends and risk section. It is also rendered outside the overview-success branch when snapshots fail or load, and it does not require a lifetime baseline or an account-currency choice. Existing account currency persistence, lifetime performance, risk, positions and ledger sources remain unchanged. Current account tiles are explicitly qualified Current, with a responsive grid adjusted after removing the old realized tile.

Removed the venue-reported Realized P&L headline tile and only the realizedPnl series from HubPerformanceTrends. Equity and unrealized P&L retain their snapshot sources and explicit independent last-30-days scope.

The earlier residual calculation was reviewed through the captured baseline and preserved stash. It is not present or referenced in the active source tree and is not an appropriate source for gross trading profit. The stash `cc5380069f44c51dbca0bcb0af0651397ef909c6` remains intact; no preserved files were applied, overwritten or deleted. Its dashboard residual is superseded by the Hub-supplied gross-profit presentation in this package.

## Metrics, partitions and controls

The section displays supplied calculated_realized_gross_profit, qualified Before fees and funding; fee_expense, rebates and net_trading_cost; verified signed net_funding with Paid/Received/zero qualifications; and distinct execution_count, executed_quantity, premium_turnover and notional_turnover measures. Source-reported funding appears only in expandable comparison context after inspecting funding. Component counts are explicitly distinguished from execution counts.

Every amount remains an exact string. Long values wrap rather than round through binary numbers, and quantities keep their returned units. Available zero, partial subtotal with missing/eligible counts, all-missing, absent/ineligible and no-record results have separate copy. Fees remain visible even when profit or funding is unavailable. Partial funding/cost direction labels refer only to the available subtotal; an incomplete zero is labelled Zero available subtotal rather than claiming no total funding or expense.

The local Analytics currency selector uses returned totals/daily groups. It prefers the resolved current account currency if present, otherwise the sole available currency, and requires a choice when several remain with no match. Unknown currencies are explicit choices. It never writes reporting_currency or adds a currency request filter. Same-currency denomination and quantity-unit partitions have separate labelled cards/charts; no totals are computed across them. Selection lives in the mounted dashboard only.

Trading period controls expose month to date, last 30 days and validated inclusive custom dates in UTC, using Package 3's captured window. Draft custom dates do not silently change displayed results; Apply dates changes the period only after validation. Original UTC start/end bounds remain visible. Snapshot and lifetime scopes remain independent.

Coverage displays processing status/time, collection time, unverified history, inventory status and counts, source-history bounds, notes, normalization version and missing build-evidence limitations. Live processing remains neutral; readiness never certifies complete economics. Known reasons have plain-language copy, and expanded details retain original/future codes.

## Chart and result inspection

Daily gross-profit bars retain positive/negative signs and missing-component markers. Calendar positions preserve gaps without constructing absent zero days. Explicit zero rows have accessible day buttons and plot markers. Native titles and focus/hover tooltips use exact strings and partial counts; an accessible daily table contains the original values.

Only chart coordinates use JavaScript numbers. Overflow, underflow and an unrepresentable scaled bar are excluded from the plot with an explanation beside the exact table value. The chart never supplies or replaces period totals.

Eligible metric values and day buttons open focused inline result details, retaining the originating metric, exact dimensions, original window and filters. Details expose exact value, availability, component counts and notes. Escape and Close restore focus to the originating control. Details are discarded when the completed pair or selected currency changes, preventing mixed-build display.

This is summary/day inspection, not a transaction listing. The paginated contributing-transaction drawer, day-window filter intersection, accounting-trace expansion and cursor/build restart sequence remain Package 5. Its selection context is prepared without issuing any detail requests in Package 4.

## Validation

- Full suite: `npm test -- --maxWorkers=2 --minWorkers=1` — **670 passed, 1 credential-gated live test skipped**, across 69 passed files and one skipped file.
- New trading presentation suite: **16 tests**, covering exact metric selection, funding signs, costs/rebates, partitions and local choices, zero/partial/missing/ineligible/empty states, loading/failure isolation, pending/stale/live qualifications, result inspection, both chart signs, keyboard actions, exact tooltips, overflow/underflow, UTC custom dates and coverage.
- Dashboard regression tests verify section ordering, current-account currency independence, removal of venue-realized headline/trend, retention of equity/unrealized snapshot trends and existing views.
- `npm run typecheck`: passed.
- `npm run build`: passed with the existing application-chunk-size warning; no bundle splitting changes were made.
- `git diff --check`: passed.

A temporary localhost-only harness rendered clearly labelled synthetic UI fixtures with the real theme and components. Browser review covered a 1280 × 960 desktop viewport and a 375 × 812 mobile viewport, long decimals, mobile custom-date controls, positive/negative layout behavior from tests, explicit zero-day selection, Escape close and actual focus restoration. The mobile document width matched its available client width; no horizontal page overflow was observed. Exact daily values remain available in their scrollable table. Typography was refined so long decimals and units remain readable in narrow cards.

The harness and review tab were removed, the viewport override reset and the development server stopped. Local review images were saved at `/private/tmp/trading-analytics-package4-desktop.png` and `/private/tmp/trading-analytics-package4-mobile.png`. These contain synthetic fixtures only and are not financial acceptance evidence. No production analytics calls or deployment occurred.

Package 4 gate passed: component/dashboard tests establish metric definitions, labels, partitions and loading/error independence. Transaction-detail and authenticated six-account acceptance gates remain Packages 5 and 6. Recommend a separate Package 4 commit, push and PR to main; none was performed during implementation.
