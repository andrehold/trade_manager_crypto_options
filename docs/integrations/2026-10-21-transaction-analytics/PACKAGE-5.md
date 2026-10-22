# Package 5 — contributing transaction details

Completed 22 October 2026 on `feat/transaction-analytics-details`, based on merged Package 4 PR #161 (`633a1b1`).

## Scope and presentation

Eligible metric cells and daily profit bars now open a modal transaction drawer. The selected summary value, exact metric, component counts, partition and originally captured period remain visible. Opening a drawer does not advance a relative period, refresh snapshots or request the full transaction history. The first request has a 50-row limit; Load more follows the opaque cursor until null, with an explicit end-of-results state.

Rows show UTC time, instrument, category, exact selected metric, its units, denomination, quantity unit and missing-data explanations. Null-valued eligible contributors remain in the table. Each row expands into a full-width accounting explanation containing the supplied status, method, contract family, quantity and basis before/after, opened/closed quantity, available prices, gross profit, source comparisons, reconciliation fields and original reason codes. Omitted accounting fields are not invented, and explicit nulls remain unavailable. Source-reported profit and funding remain comparison context. No arithmetic, cost-basis reconstruction, FX conversion or closed-trade net profit is calculated in the portal.

The drawer traps focus, makes the background inert, prevents background scrolling, closes on Escape or Close and restores focus to the originating metric/day control when it is still present. It retains focus when pagination removes its button. Narrow-screen table rows stack and exact strings wrap. Accounting expansions occupy the table width rather than a narrow explanation column.

## Exact filter construction

`dashboard/analyticsDrillFilters.ts` retains all originally applied filters, selected metric and the original captured bounds. Day and month buckets intersect that window in UTC, retaining original submillisecond strings when an original boundary wins. Profit does not acquire a trading-only category filter: exercise and delivery remain eligible.

Currency, denomination and quantity unit are preserved independently. Null currency, quantity unit and grouped instrument use explicit null-only flags. Contradictory dimensions/filters and nonoverlapping buckets are rejected rather than broadened.

The contract has no denomination-null filter and requires string transaction denominations. An unknown/null denomination therefore opens an explanation without requesting unrelated partitions. Null grouped category is treated similarly because the provider has no category-null filter. This service limitation is explicit; no unsupported query field or substitute denomination is invented.

## Pagination, build recovery and isolation

`useAnalyticsTransactions` validates every page's account, available venue identity and exact requested window, plus non-null row account/venue identities, partition/filter membership and metric eligibility. It detects duplicate row IDs (within/across pages), repeated/cyclic cursors and unexpected identity changes before appending. Every page uses unchanged filters. The session is checked before requests, again after completion, and on errors before retaining data. Auth events clear data and cancel the generation on logout, user or client switches. Late responses are ignored; closing or changing the context aborts outstanding requests. The browser never supplies an authoritative Hub account ID.

A cursor/build-related 400, publication 409 or detected build discrepancy discards the in-progress sequence. It requests a summary retry for the **same captured window**, waits for that completed summary pair, then restarts page one once. A second conflict stops with manual retry; generic validation 400 errors do not trigger automatic retries. Explicit summary build changes also invalidate in-flight pages and use the same bounded recovery budget.

Only an earlier completed full sequence for the identical request/account/session context may remain during rebuilding, labelled Previous results. Replacement rows are never appended to that sequence. Errors without positive account evidence clear retained rows; identity, authorization and invalid-response errors clear/block the details. Rate limits respect Retry-After, including when a rebuild is waiting on the summary.

Available processing time, normalization version and status are compared against the latest summary and across pages; missing/present build fields must remain consistent within a sequence. The selected original summary snapshot remains labelled as older if the summary refresh changes its build. The drawer explicitly says new details do not reconcile to that old cell and directs the user to select the refreshed metric. Missing build evidence is shown as an inability to verify matching builds, not represented as a guaranteed transactional build token.

Selections close on account/period/filter loss and do not reappear when data later returns. The existing snapshot, lifetime, risk, position and ledger sources are unchanged.

## Validation

- Full suite: **711 passed, 1 credential-gated live test skipped** across 72 passed files and one skipped file.
- Added 41 tests: six filter/intersection tests, 27 pagination/identity/recovery hook tests, and eight drawer/accounting/focus integration tests. Existing trading presentation tests now cover retaining a selected snapshot during same-context refresh and closing on a period change.
- Coverage includes both cursor/publication errors, generic 400, changed/missing build metadata, duplicate IDs, cursor cycles, page/row identity mismatches, invalid partitions/windows, unavailable eligible rows, complete-only previous results, aborted late pages, logout/user/client switches, identity rechecks on successful and failed pages, forbidden access and rate limits.
- `npm run typecheck`: passed.
- `npm run build`: passed with the existing application-chunk-size warning.
- `git diff --check`: passed.

A temporary localhost-only review harness used synthetic auth and vendored synthetic transaction fixtures; its fetch implementation rejected all other application requests. Browser checks covered 1280 × 960 desktop and 375 × 812 mobile, two-page completion, unavailable reasons, full-width accounting expansion, long exact decimals, focus retention after pagination, Escape close and focus restoration. Document width did not exceed the available client width in either layout.

Review screenshots: `/private/tmp/trading-analytics-package5-desktop.png` and `/private/tmp/trading-analytics-package5-mobile.png`. These are synthetic UI evidence, not financial reconciliation or production acceptance evidence. The temporary harness was removed, the server stopped, the review tab closed and the viewport override reset.

Package 5's fixture-backed gate passes: a selected summary/day cell retains its exact request context through complete pagination, with missing contributors visible and no duplicate or observably mixed-build rows. Live six-account reconciliation, publication-semantics confirmation, response-size/latency measurement and release sign-off remain Package 6. No production requests, deployment, commit, push or PR were performed during this implementation step. Recommend a separate Package 5 commit, push and PR.
