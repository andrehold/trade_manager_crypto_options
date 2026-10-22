# Package 3 — authenticated analytics client and mounted state

Implementation on `feat/transaction-analytics-state`, based on merged Package 2 PR #159 (`da74be8cd627a7cc2f634e36842680e10678ff29`). Dashboard cards, currency controls, charts and transaction-drawer presentation remain Packages 4 and 5.

## Client and captured period

`analyticsClient.ts` provides typed summary/detail filters and requests to the protected portal routes. It uses the existing Supabase bearer-token transport; it never accepts or forwards an authoritative Hub account ID. The client validates returned portal values against the captured analytics schemas, preserving decimal strings, units, nulls, absent metrics, accounting traces and opaque cursors. It rejects numeric financial values. Existing client errors now recognize all three analytics-specific codes, and the shared transport accepts an optional abort signal without changing existing callers.

Period helpers capture month-to-date in UTC by default, the preceding 30 × 24 hours, or inclusive custom calendar dates converted to an exclusive following midnight. Invalid ranges are rejected before requests. The hook stores one exact window for totals, daily profit and subsequent detail requests. Filter changes and retry preserve this window. Manual refresh advances relative presets; custom refresh reuses the exact range. Opening details through the typed client requires an explicit window and does not recapture time.

## Atomic summary state

`usePortfolioHubAnalytics` requests two summaries concurrently: totals without optional grouping/metric defaults, and daily `calculated_realized_gross_profit` with `groupBy: ['day']`. There is no snapshot, position, baseline, reporting-currency or lifetime dependency and no initial transaction fetch.

A completed pair must agree on account, available venue identity, requested UTC instants, expected grouping, available processing timestamp, normalization version and processing status. Account changes between reads, changed build metadata or publication 409s restart the entire pair once. A second conflict exposes a manual retry action; generic query/auth/network failures do not trigger this retry. Period totals remain supplied independently and are never manufactured from daily bars.

Missing build evidence is carried in `consistencyLimitations`, even on ready responses. Matching timestamps/version are comparison evidence, not a transactional build guarantee. `pending` is an explicit hook state with the actual returned groups; stale/live qualifications remain available in coverage. The hook's ready state means a pair is available, not that processing or economics are certified complete.

## Ownership, refresh retention and races

Data is local to the mounted dashboard provider. Its completed entry is keyed by stable auth user, client claim, protected-response account, exact period and filters; access tokens are excluded. There is no persistent or module-wide analytics cache.

The hook observes auth changes, checks session identity before requests and again before publishing or retaining results, aborts old requests and ignores obsolete generations. Logout, client/user changes, observed remapping and period/filter changes clear prior values. A normal token refresh keeps the same identity without fetching; subsequent explicit requests use the new token. Mapping hints from an available overview invalidate old results but never route requests or gate analytics availability. A newly observed mapping is masked before the invalidation effect runs.

An identical context retains the last complete pair during refresh. A failed refresh may retain it with `refreshError` only when both request outcomes confirm the same mapped account and no auth/schema/mapping failure requires eviction. Errors from the protected analytics routes now include `x-portfolio-hub-account-id` only after successful session/mapping resolution, following the existing performance-route convention. The header is current-mapping evidence, not browser routing authority. A network failure without mapping evidence conservatively clears old results rather than assuming the mapping is unchanged. Simultaneous failures prioritize authorization and invalid-response errors over recoverable errors.

There is no polling or focus-triggered refresh. Rate-limit cooldown expiry only re-enables manual retry; it does not request data. Pending/partial pair responses are never substituted with examples or fabricated zeroes.

## Dashboard boundary

`PortfolioHubAnalyticsProvider` wraps the dashboard independently of overview and lifetime success/failure branches. It is active only on the dashboard; navigating elsewhere unmounts its hook and discards selections/data. It exposes context for Package 4 to render trading results even if snapshot or lifetime requests fail. The existing account overview, lifetime presentation and snapshot refresh controls retain their current behavior. No trading metrics or new UI controls are rendered in this package.

## Validation

- Analytics client/period/consistency tests: **23 passed**.
- Mounted hook/provider tests: **31 passed**, covering pair races, late auth/session responses, identity/client switches, remapping, refresh retention, authorization precedence, bounded recovery, pending/stale/live results, UTC filters, cooldowns, StrictMode and unmount.
- Shell tests: **31 passed**, including four additional boundary/isolation checks.
- Analytics route tests: **46 passed**, now also checking mapped-account evidence on post-mapping errors and its absence on method rejection.
- Full suite: `npm test -- --maxWorkers=2 --minWorkers=1` — **652 passed, 1 credential-gated live test skipped**, across 68 passed files and one skipped file.
- `npm run typecheck`: passed.
- `npm run build`: passed with the existing large-application-chunk warning; no bundle-splitting changes were made.
- `git diff --check`: passed.

The first client round-trip checks found and fixed a non-writable temporary field descriptor. Type checking also prompted a complete typed Session fixture. An initial full-suite run encountered a shared roughly 190-second delay and timeouts in new and unchanged suites, plus a subsequent analytics assertion failure. The affected suites passed together on rerun; the full suite then passed with concurrency limited to two workers without increasing timeouts or changing those existing tests.

Package 3 gate passed: tests cover request races, identity switches, independent failures, consistency checks and same-context refresh retention. Provider publication guarantees and authenticated six-account production validation remain integration work. The existing residual-tile work remains safely stashed and outside this package. No production analytics requests, deployment, commit, push or PR were performed during implementation.

Recommend a separate Package 3 commit, push and PR to main before beginning Package 4.
