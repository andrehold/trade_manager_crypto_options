# Package 6 — final validation and rollout preparation

Validation performed 22 October 2026 on `test/transaction-analytics-release-validation`, based on merged Package 5 PR #162 (`e7671c9`). This is the final package in the implementation plan. **The available validation is complete; full release sign-off remains pending the portal/runtime checks below. No deployment is authorized by this package.**

## Independently executed live evidence

[Sanitized acceptance report](RELEASE-VALIDATION-2026-10-22.json) records the actual runs, counts, response-size/timing measurements and remaining gaps. The earlier provider/operator report remains unchanged and is not used as a substitute for this run. Actual account IDs were discovered through the existing server-side read key; synthetic IDs were never sent to production. Credentials, financial amounts, transaction payloads, IDs, opaque cursors and authentication bodies were not saved.

The supplied `analytics_smoke.py` and `analytics_client.py` were read before execution, extracted to a temporary directory from the original handoff and run without changing their acceptance logic. Instrumentation measured successful response bodies and elapsed time. The saved report includes the scripts' SHA-256 hashes. The tool performed only authenticated reads, missing/invalid-auth rejection checks and validator-only Decimal reconciliation. It did not modify the Hub, worker, mappings, database or deployment.

| Account | Venue | Detail rows | Metric checks | Available calculated-profit rows | Processing | History complete |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Annamite | Deribit | 238 | 2,407 | 125 | ready | false |
| Coincall | Coincall | 6,240 | 92,403 | 6,225 | ready | false |
| DWF | Deribit | 2,181 | 25,727 | 1,838 | ready | false |
| Nickel | Deribit | 500 | 4,045 | 220 | ready | false |
| Paradex | Paradex | 4,417 | 15,210 | 226 | ready | false |
| Paradex-HYPE | Paradex | 299 | 1,266 | 19 | ready | false |

**Total: 13,875 detail rows, 141,058 metric checks and 8,653 available calculated-profit rows.** All six accounts passed the supplied smoke, including complete observed-history pagination, period/day/month agreement, eligible/missing counts and weighted mark checks. These counts do not certify source-history completeness or eliminate known financial gaps.

A new opt-in application acceptance suite additionally used the production parsers, captured summary-pair validation, actual filter helper and row/build validation against all six discovered accounts. It reconciled **56 selected metric/day/custom-period cells through 75 complete 50-row pages**, including six partial samples and eleven null-partition samples. Samples cover each eligible release metric, daily gross profit and a user-selectable one-day custom period. Ineligible metrics are recorded as such. No null denomination was observed in the six period-total responses; the unsupported-null-denomination explanation remains in place.

The supplied smoke already covers full observed-history reconciliation. The application sweep samples representative days and one-day custom periods to avoid downloading that full history again for every individual metric. Summation exists only in acceptance tests, never in the displayed financial results.

## Actual authenticated portal coverage

The configured approved test user signed in to the existing Supabase service. The actual RLS mapping resolved to **Paradex**. Its real protected handlers, browser client parser, paired summaries, daily cell and complete transaction page passed without requesting snapshots or lifetime performance. Cache responses remained private/no-store, and a request without a portal session returned 401. This was an in-process protected-handler integration with real authentication/RLS and the live Hub; it was not deployed-browser end-to-end testing.

An additional configured development login signed in but the RLS client query did not resolve to exactly one client. It was denied with **403 CLIENT_NOT_LINKED**. This is an access/setup gap, not positive coverage for a second account. No client links, claims or permissions were repaired or bypassed.

Positive authenticated portal coverage for Annamite, Coincall, DWF, Nickel and Paradex-HYPE still requires their approved linked test sessions. Direct Hub validation for these accounts passed. Controlled gateway/hook tests cover isolation and identity switches, but do not replace those remaining live client-session checks.

The user explicitly chose to **record the remaining portal coverage gap** on 22 October 2026. These five client-session checks are deferred and remain unverified. This records the requested validation boundary; it does not waive the remaining rollout checks or authorize deployment.

## Findings corrected during validation

1. **False null-filter semantics.** The provider treats `*_is_null=false` as no null-only restriction. The drill helper had interpreted it as excluding nulls. It now allows a returned null partition and narrows that partition with the supported true null-only flag. Non-null partitions retain applicable false flags; actual contradictory value/true-null filters still fail. Regression coverage includes row membership with all three false flags and exact null drill construction.
2. **Analytics request budget.** Body-inclusive live measurements exceeded the existing 10-second timeout. Analytics now has a separate server-only `PORTFOLIO_DATA_HUB_ANALYTICS_TIMEOUT_MS`, default **30000**, configurable from 500 to 30000. Snapshot/auth/mapping and other route timeouts retain their existing setting/default of 10000. Preflight validates both independently. Clock-controlled tests prove the default/override deadlines, abort behavior and unchanged snapshot budget/error contract. `.env.example` documents the setting; production secret configuration was not changed.

## Measured response behavior

| Run/resource | Requests | Largest JSON body | p95 elapsed | Maximum elapsed |
| --- | ---: | ---: | ---: | ---: |
| Supplied smoke summaries, including day/month × instrument/category | 24 | 12,391,375 bytes | 16,899 ms | 25,296 ms |
| Supplied smoke detail pages (up to 200 rows) | 73 | 595,021 bytes | 11,010 ms | 12,829 ms |
| Application-shape summaries, including all-metric days | 30 | 717,804 bytes | 6,388 ms | 6,435 ms |
| Application-shape detail pages (50 rows) | 75 | 145,159 bytes | 4,106 ms | 4,177 ms |
| Final mapped portal summaries (Hub leg) | 3 | 20,395 bytes | 3,656 ms | 3,656 ms |
| Final mapped portal detail page (Hub leg) | 1 | 11,465 bytes | 1,303 ms | 1,303 ms |

These are observations from this machine/run, including response-body reads, not reliable long-term production percentiles. Node sizes are decoded payload bytes, not compressed transfer sizes. Concurrent acceptance activity can increase latency. The 30-second analytics budget supplies headroom above the largest observed response; the deployed platform's own request-duration limits still need confirmation. No polling, prefetch-all detail behavior or cross-account UI aggregate was added.

## Publication/coverage interpretation

Provider source at local checkout commit `0a9249c` was inspected without modification:

- `analytics/results.py` publishes saved rows and state together; reads compare `(normalized_at, input_signature, normalization_version)` before/after loading and raise a publication conflict if this changes.
- `api/routes/analytics.py` fingerprints account, returned processing time/version and all effective filters into the cursor. Page size is excluded; a changed fingerprint produces the recognized cursor/build 400. Read publication conflicts become 409.
- Saved-result reads return pending, ready or stale based on stored state/input/version/snapshot checks. The additive schema's `live` value was not observed in these runs and retains the neutral UI wording.

The live checks observed usable processing timestamps/version metadata and consistent summary/detail builds. The internal input signature is not a public build token. Separate summary requests still rely on available metadata comparison and bounded retries. No rebuild was forced in production: controlled 400/409 fixtures validate recovery, duplicate prevention, complete-only previous results and late-request cancellation. The local source revision was not independently tied to the deployed binary, so this source review is supporting evidence, not proof of deployment equivalence.

All accounts continue to report `history_complete=false`. Preserve Nickel spot-BTC basis gaps; Paradex unwind/realization and settlement-conversion gaps; missing execution marks; unverified nonzero funding direction; and per-result missing reasons. Ready remains a processing state. No stablecoin parity, reconstructed basis, net closed-trade profit or converted/cross-partition total is introduced.

## Final local and visual validation

- `npm test -- --maxWorkers=2 --minWorkers=1`: **727 passed, 3 skipped** across 72 passed files and two skipped live files. Live opt-in tests are intentionally separate; the existing overview/lifetime direct smoke was not run as part of this analytics release check.
- Focused server/preflight checks: **69 passed**.
- Explicit live application runs: **two positive tests passed** (six-account parser/drill sweep; mapped Paradex portal integration). A separate exploratory development-login check failed at mapping as recorded above.
- `npm run typecheck`: passed.
- `npm run build`: passed. Existing application-chunk warning remains (about 1,002 kB minified / 281 kB gzip).
- `node --env-file=.env.local scripts/portfolio-data-hub-preflight.mjs --production`: passed. This validates local configuration placement/shape only, not deployed secrets, key scopes or runtime settings.
- `git diff --check`: passed.

A temporary localhost-only harness exercised the actual summary hook, UI and detail hook with explicitly synthetic auth/data. Application fetches outside the mock analytics routes were rejected. Desktop 1280 × 960 and mobile 375 × 812 review covered negative profit, zero-day keyboard activation and exact window intersection, Escape/focus restoration, same-currency partitions, unknown currency/unit labels, unavailable funding alongside supported costs, pending processing and long decimals. Document width matched the available client width. Browser screenshots contain synthetic values only:

- `/private/tmp/trading-analytics-package6-desktop.png`
- `/private/tmp/trading-analytics-package6-long-mobile.png`
- `/private/tmp/trading-analytics-package6-partitions-desktop.png`

The temporary UI harness was removed, server stopped, viewport reset and review tab closed. No live account data was displayed in or captured from the browser.

## Repeatable operator checks and remaining release gate

For the application sweep, securely inject the existing Hub/Supabase server settings and `PORTAL_TEST_AUTHORIZED_EMAIL` / `PORTAL_TEST_AUTHORIZED_PASSWORD`, then run `npm run test:portfolio-data-hub:analytics`. `PORTFOLIO_ANALYTICS_REPORT_PATH` optionally writes the counts-only report. Keep these settings out of Vite/browser configuration and source control. The approved login must already map to exactly one intended client through RLS. An optional `RUN_PORTFOLIO_ANALYTICS_DEV_CLIENT=1` also checks the existing development-client login; it fails if that login is unlinked. This does not grant access or repair a mapping.

The supplied read-only smoke can be repeated from the extracted original handoff with its reviewed hash and server-side `PDH_API_KEY`; use the command in the provider's START_HERE. Never use fixture IDs against production, recreate/rebuild production results to simulate conflicts or run migrations/worker changes as an acceptance shortcut.

| Completion criterion | Evidence / remaining limit |
| --- | --- |
| Same gross-profit definition and captured window | Paired-summary/unit tests; live period/day reconciliation across six accounts. |
| Costs/funding/activity with exact units and partitions | Live eligible-metric cell checks plus unavailable/zero/partial controlled cases. |
| Independent analytics availability | Actual mapped portal handlers issued zero snapshot requests; dashboard isolation tests pass. |
| Distinct availability/processing/history states | Component tests and final synthetic desktop/mobile review; live history limitations recorded. |
| Correct contributing details and null dimensions | Live partial/null samples, exact filter tests, no observed null denominations; unsupported denomination-null queries remain explicit. |
| Pagination and rebuild recovery | Full-history supplied smoke plus 75 application detail pages; controlled 400/409 recovery. |
| Authentication/account isolation | Actual Paradex RLS mapping, denied unlinked login, no-session 401 and controlled cross-account/identity tests. Five live mapped client-session checks remain pending. |
| Existing current/lifetime/risk/positions/ledger sources | Regression suite passes; snapshot timeout default remains unchanged. |
| Old realized residual/trend removed | Dashboard/chart regression tests pass. |
| No app-side financial reconstruction/conversion | Source review and supplied-string presentation tests; validator arithmetic is test-only. |

**Before release sign-off:** obtain positive portal coverage for the remaining five linked client identities (or an explicit release-owner decision on that gap), confirm the deployed portal/runtime duration and server-only key scope/configuration, and verify the actual release candidate in the deployed environment. Source-history/financial limitations must remain visible. This package prepares a reviewable final implementation and evidence; it does not claim those outstanding checks passed.

Recommend committing, pushing and opening a separate final validation PR. No commit, push, PR, merge, deployment, Hub rebuild or production configuration/mapping change was performed during this implementation step. Unrelated documents appeared in `output/` during validation; they were left untouched and are outside this change.
