# Package 1 validation — 21 October 2026

Package 1 gate passed: field mapping is documented and representative fixtures are captured before UI implementation.

- Before changes, the existing HubPortfolioView and realizedPnl tests passed: 2 files, 52 tests. Type checking also passed.
- New contract fixture checks passed: 1 file, 20 tests (`npm test -- src/lib/portfolioDataHub/__tests__/analyticsContractFixtures.test.ts`). These verify vendor checksums against local provenance and the supplied manifest, six reference account/venue identities, supplied structural fields, metric allowlists, exact decimal strings, processing/availability/partition cases and the synthetic partial-detail relationship.
- Type checking passed after the new fixture tests (`npm run typecheck`).
- `git diff --check` passed.
- SHA-256 comparison confirmed all four pre-existing source/test files are unchanged from `baseline.json`. The plan's original hash was also checked before intentionally updating its status.

The first test pass exposed a nullable-reference handling bug in the new capture checker; it was corrected. The initial type check exposed use of an ES2022 array helper outside this project's ES2020 target; it was replaced. Both checks passed afterward.

No application code, routes, credentials, account mappings or production configuration changed. No bundled scripts, live account requests or smoke checks ran. The full suite and production build were not run for this documentation/fixture package; integration-wide checks remain Package 6. Fixtures are display/contract evidence, not current financial evidence.

Open integration questions are recorded in README: provider meaning of `live` beyond the schema literal and actual publication/build identity guarantees. The plan already defines safe handling pending clarification, so these do not block the next schema/route package.

## Branch cleanup after Package 1

GitHub confirms lifetime-performance [PR #157](https://github.com/andrehold/trade_manager_crypto_options/pull/157) was merged on 16 October 2026 at `c99746860ea6d7719b8f2ef3543bf99141ae4637`. The earlier local `origin/main` was outdated. After fetching, the old branch tip was confirmed to be an ancestor of current main.

Local main was fast-forwarded, and `feat/dashboard-transaction-analytics` was created from it. The merged local `feat/lifetime-performance-contract` branch was deleted; the remote branch was not modified.

The four pre-existing residual-tile source/test changes were preserved separately in stash commit `cc5380069f44c51dbca0bcb0af0651397ef909c6`, named `Preserved residual P&L tile before transaction analytics Package 1`. Both tracked and untracked file contents were checked against the pre-cleanup SHA-256 backup. Package 1 files also matched their pre-cleanup hashes before this documentation update. The original baseline remains historical evidence, not the current checkout state.

The active working tree now contains only Package 1 documentation, fixtures and the contract-fixture test. Recommend a scoped Package 1 commit on the new branch, followed by push and a PR to main. No commit, push or PR was performed during cleanup.

Post-cleanup verification: the contract-fixture and HubPortfolioView suites passed together (2 files, 58 tests), type checking passed, and `git diff --check` passed. The residual helper and its extra dashboard test remain preserved in the named stash.
