# Package 2 — schemas and protected analytics gateway

Completed 21 October 2026 on `feat/transaction-analytics-gateway`, based on merged Package 1 PR #158 (`28afa1b6bef6eff5e3a737ba3a238134d6f2cb29`). No UI or client-state implementation is included.

## Boundary and model

The two GET-only edge routes are `/api/portfolio-data-hub/analytics/summary` and `/api/portfolio-data-hub/analytics/transactions`. They use the existing Supabase session verification and caller-JWT/RLS client mapping on every request. The browser cannot choose an authoritative Hub account ID; unknown and duplicate query parameters are rejected before calling Hub. Mapping does not require a reporting currency, lifetime baseline or successful snapshot request. No account-discovery route was added.

Responses use the existing `{ data: ... }` envelope and `private, no-store` cache policy, including errors. Hub requests use server-only authorization, no-store caching and reject redirects. Envelope account identity, non-null row account IDs, available envelope/row venues, requested time bounds and summary grouping are checked. The mapping has no independent venue field; consistency uses the venue information available in the response without adding a snapshot dependency.

Additive-compatible Zod schemas cover coverage, metrics, mandatory monetary/unit partitions, summary groups, transaction pages and accounting explanations. Analytics does not require `canonical_schema_version`. Known portal field names become camelCase; metric names, reason codes and free-form dictionaries retain their Hub keys. Ambiguous fields that would collide after normalization are rejected. Exact decimal strings, exponent notation, explicit nulls and absent metrics remain distinct. Unknown additive metric names are accepted in responses; requests use the captured allowlist.

The schema's `live` state remains neutral. Missing optional processing timestamps/version become null, rather than invented build evidence. Missing optional component counts become null. The supplied defaults for processing/history/inventory state are accepted; ready still says nothing about complete economics or source history.

## Filters

Shared filters: aware start/end, instrument, category, currency, denomination, quantity_unit, metric, and instrument/currency/quantity-unit null flags. Null flags accept `true`/`false`; true conflicts with its value filter. No denomination-null filter exists. Exact units and opaque cursors are not rewritten. Date ordering and response-window checks preserve sub-millisecond precision and allow equivalent timezone offsets.

Summary grouping accepts any unique subset of day, month, instrument, category and currency, including day/month together. Empty/no grouping requests totals; no metric, currency or category default is inserted. Detail limits are 1–200, default 50. Invalid query input is rejected before forwarding to Hub. There are no automatic retries in this gateway; pair and pagination recovery belong to Packages 3 and 5.

## Error contract

| Condition | Portal status | Code |
| --- | --- | --- |
| Unsupported/invalid portal analytics input | 400 | `ANALYTICS_INVALID_QUERY` |
| Generic Hub query rejection | 400 | `ANALYTICS_INVALID_QUERY` |
| Recognized cursor/build/filter mismatch on a cursor request | 400 | `ANALYTICS_INVALID_CURSOR` |
| Publication changes during read | 409 | `ANALYTICS_PUBLICATION_CONFLICT` |
| Hub credential/scope rejection | 401/403 | `HUB_AUTHORIZATION_FAILED` |
| Mapped Hub account not found | 404 | `HUB_ACCOUNT_NOT_FOUND` |
| Unsupported Hub filters/venue | 422 | `ANALYTICS_INVALID_QUERY` |
| Rate limit | 429 | `HUB_RATE_LIMITED` with validated Retry-After when supplied |
| Upstream 408/504 or aborted request | 504 | `UPSTREAM_TIMEOUT` |
| Hub service unavailable | 503 | `HUB_UNAVAILABLE` |
| Other upstream/network failure | 502 | `HUB_UNAVAILABLE` |
| Invalid response, account/venue/window/group mismatch | 502 | `HUB_INVALID_RESPONSE` |

Existing portal auth/mapping errors retain their existing codes. The generic fetchHub implementation and other datasets' error behavior were not modified. Error messages are controlled portal text; raw upstream bodies, credentials and diagnostic exceptions are not returned or logged by the analytics path.

The captured prose does not specify structured cursor subcodes. Read-only inspection of the local provider implementation established two currently recognized exact diagnostics: `Invalid pagination cursor.` and `Invalid pagination cursor or changed filters.` Only these on detail requests with a cursor map to `ANALYTICS_INVALID_CURSOR`. An unknown/new 400 stays a generic query rejection even if a cursor is present; it must not cause blind retries.

Local source evidence (not a claim about deployed production code):

- `portfolio-data-hub/src/portfolio_data_hub/api/routes/analytics.py`, SHA-256 `407aec818aacbf9699cfc49aedf4b04ee67fcb4557bcb37a7258412483f46583`.
- `portfolio-data-hub/src/portfolio_data_hub/api/pagination.py`, SHA-256 `0e4d3b6249e9581c2684b7c15a01d4b767e01edb0df1fbf5e5a30add08d8304a`.

Both were read under `/Users/andreholschick/Desktop/portfolio-data-hub`; no provider code was modified or executed.

## Validation and gate

- Schema/normalizer/query suite: 65 tests, covering six reference accounts, synthetic states, allowlist agreement, exact values, additive fields, null filters, aware instants and all grouping combinations.
- Protected analytics route suite: 46 tests, covering auth/RLS mapping, account isolation, supported filter forwarding, independent analytics requests, response validation, safe error distinctions and no secret leakage.
- Full suite: **594 passed, 1 credential-gated live test skipped**, across 66 passed files and one skipped file. Existing server, portal and performance tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed with a warning that an application chunk exceeds the configured 900 kB threshold. No bundle splitting changes were made in this package.
- `git diff --check`: passed.

The first validation pass found and fixed cross-runtime AbortError classification in the analytics-only path and test typing issues. Subsequent suites and type checking passed.

Package 2 gate passed: tests prove account isolation, query forwarding, safe actionable errors and parsing of valid responses. No authenticated production analytics requests or deployment were performed. Publication consistency guarantees, deployed latency and real-account smoke validation remain integration checks. Existing residual-tile work stays in its named stash from Package 1 cleanup.

Package 2 is prepared as a separate commit and PR to main. The validation results above were recorded before publication.
