# Dashboard Account-Currency Selection — Implementation Plan

> **For agentic workers:** Execute this plan test-first. Use the sub-agent waves below only after
> their dependency gate is green. All agents share one worktree, so the main agent owns commits
> and integration; sub-agents edit only their assigned files and do not commit.

**Goal:** Make the performance-and-risk dashboard select one explicit venue-native account
currency without depending on Hub component ordering, while reusing the existing persisted
client/admin choice and preserving historical gaps.

**Architecture:** Add a pure account-currency domain module that owns normalization, funding
detection, resolution, metric lookup, and historical-series construction. Adapt the existing
reporting-currency control into the user-facing Account currency selector. The dashboard renders
currency-dependent KPIs, risk values, and charts only when the resolver returns a currency. The
existing client-scoped RPC remains the only write path; no database or Hub contract changes are
required.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library, Decimal.js, Zod-validated
Portfolio Data Hub Canonical Contract v1, Recharts, Supabase RPC persistence.

**Design reference:**
`docs/superpowers/specs/2026-09-04-dashboard-account-currency-selection-design.md`

**Execution status:** Implemented on `feat/dashboard-account-currency`. Focused and full tests,
typecheck, production build, and the read-only acceptance audit pass. Live multi-currency browser
verification remains pending because the local portal's development Hub was unavailable.

---

## Global constraints

- Display direct API values only. Never convert, compare, or sum amounts across currencies.
- A valid persisted `client` or `admin` selection wins while that currency is present, even when
  all of its values are zero.
- Inference is allowed only when there is no persisted selection and exactly one funded currency.
- Inference is ephemeral: it must not call the persistence RPC or create an audit event.
- Funding is determined only from non-zero `equity`, `balance`, or `collateral` values parsed with
  the existing exact-decimal utilities. Do not use `Number`, `parseFloat`, truthiness, or epsilon
  comparisons for this decision.
- A saved currency missing from the latest summary fails closed. Do not fall back to another
  currency.
- Invalid currency labels are omitted from groups, choices, resolution, and saves. A malformed
  persisted value is treated as no valid persisted choice; database constraints should make this
  a defensive-only path.
- Metric selection is field-specific and stays inside the active currency. Never select one
  component globally and reuse it for every field.
- Historical missing values remain `null` points and render as chart gaps.
- Keep existing persistence names (`reporting_currency`, repository names, hook name, and RPC
  names). Change only client-visible terminology to **Account currency** in this slice.
- Do not change position, ledger, price, quantity, settlement-currency, or admin UI semantics.
- Do not add a migration, Hub endpoint, FX service, risk warning, or dashboard action.

## Contract details fixed by this plan

These implementation details remove ambiguity without changing the approved behavior:

- Currency groups preserve component order from the Hub response.
- `availableCurrencies` and `fundedCurrencies` are unique and alphabetically sorted.
- A valid missing persisted currency is returned as `savedCurrency` for context. An invalid
  persisted value is never displayed.
- Metric scope priority is `account`, `margin_account`, `account_valuation`, `asset_account`, then
  all remaining components in original API order.
- Duplicate historical timestamps are resolved deterministically: sort history by
  `(fetchedAt, id)`, keep the lexicographically greatest `id` for a timestamp, then sort the
  resulting points by `fetchedAt` ascending.
- The latest current summary is appended only when its exact `fetchedAt` is absent from history;
  it does not overwrite a historical point with the same timestamp.
- Historical point labels retain the full `fetchedAt` value so distinct intraday points do not
  collapse to the same date key. Display formatting may still show a shorter date.
- A trend chart requires at least two non-null numeric points. Null points do not satisfy this
  threshold.

## Files and ownership

| Area | Files | Execution owner |
|---|---|---|
| Domain contract | `dashboard/accountCurrency.ts`, its new unit test | Domain sub-agent, sequential |
| Selector | `ReportingCurrencySelector.tsx`, its test | Selector sub-agent, parallel wave |
| Charts | `AreaChart.tsx`, `HubPerformanceTrends.tsx`, their tests | Chart sub-agent, parallel wave |
| Integration | `HubPortfolioView.tsx`, `ClientPortalShell.tsx`, hook copy, integration tests | Main agent |
| Acceptance audit | Read-only review of the completed diff | Review sub-agent |

Files that form one behavior boundary stay with one owner. In particular, do not split
`HubPortfolioView.tsx` from its test, or `HubPerformanceTrends.tsx` from `AreaChart.tsx`.

## Multi-agent execution protocol

1. The main agent performs Task 0 and records the baseline.
2. Assign Task 1 to one domain sub-agent. No consumer work begins until the main agent reviews
   its exports and the focused test/typecheck gate passes.
3. After Task 1, run Tasks 2 and 3 concurrently with two sub-agents. Their file sets are disjoint.
4. Stop both parallel agents before the main agent begins Task 4. The main agent reviews their
   diffs, resolves any contract mismatch, runs the combined gate, and makes the commit.
5. The main agent alone performs dashboard/shell integration in Task 4.
6. Assign Task 5 to a read-only review sub-agent. The main agent applies any corrections and owns
   all final verification and commits.

Sub-agent prompts must include the relevant task text, exact file ownership, the frozen domain
interfaces, the focused verification command, and: **do not edit other files; do not commit**.
Agents should report changed files, test results, and unresolved concerns. The main agent should
inspect every diff rather than accepting a completion message as the integration gate.

---

## Task 0: Preflight and clean execution base

**Owner:** Main agent

**Files:** No product-code changes.

- [ ] **Step 1: Preserve the approved planning artifacts**

  Confirm the design and this plan are present and inspect the worktree:

  ```bash
  git status --short
  git diff --check
  ```

  Do not discard unrelated user changes. If implementation will happen on a new branch, first
  commit the planning artifacts or otherwise preserve them, then create the feature branch from
  the latest `origin/main` without destructive reset commands.

- [ ] **Step 2: Record the baseline**

  ```bash
  npx vitest run \
    src/features/clientPortal/components/__tests__/AreaChart.test.tsx \
    src/features/clientPortal/components/__tests__/ReportingCurrencySelector.test.tsx \
    src/features/clientPortal/components/__tests__/HubPortfolioView.test.tsx \
    src/features/clientPortal/__tests__/ClientPortalShell.test.tsx \
    src/features/clientPortal/__tests__/useReportingCurrencySelection.test.tsx
  npm run typecheck
  ```

  Expected: all existing tests pass. Record any pre-existing failure before changing code rather
  than weakening a test to hide it.

---

## Task 1: Build the pure account-currency domain

**Owner:** One domain sub-agent, sequential. Main agent reviews and commits.

**Files:**

- Create: `src/features/clientPortal/dashboard/accountCurrency.ts`
- Create: `src/features/clientPortal/dashboard/__tests__/accountCurrency.test.ts`

**Frozen exports:**

```ts
export type AccountCurrencyMetricKey =
  | 'equity'
  | 'balance'
  | 'collateral'
  | 'availableFunds'
  | 'availableWithdrawalFunds'
  | 'initialMargin'
  | 'maintenanceMargin'
  | 'realizedPnl'
  | 'unrealizedPnl'

export type AccountCurrencyResolution =
  | {
      status: 'resolved'
      currency: string
      source: 'client' | 'admin' | 'inferred'
      fundedCurrencies: string[]
      availableCurrencies: string[]
    }
  | {
      status: 'selection-required'
      reason: 'multiple-funded' | 'no-funded-currency' | 'saved-currency-missing'
      savedCurrency: string | null
      fundedCurrencies: string[]
      availableCurrencies: string[]
    }

export type CurrencyMetricPoint = { t: string; v: number | null }

export function groupSummaryComponentsByCurrency(
  components: HubSummaryComponent[],
): Map<string, HubSummaryComponent[]>

export function fundedCurrenciesFromSummary(
  components: HubSummaryComponent[],
): string[]

export function resolveAccountCurrency(
  components: HubSummaryComponent[],
  persistedCurrency: string | null,
  persistedSource: ReportingCurrencySource,
): AccountCurrencyResolution

export function resolveCurrencyMetric(
  components: HubSummaryComponent[],
  currency: string,
  metric: AccountCurrencyMetricKey,
): ExactDecimal | null

export function buildCurrencyMetricSeries(
  history: HubSummary[],
  current: HubSummary,
  currency: string,
  metric: AccountCurrencyMetricKey,
): CurrencyMetricPoint[]
```

Use `normalizeReportingCurrency` from `reportingCurrencyRepo.ts`, and validate any value used in
funding detection with `exactDecimalSchema.safeParse` before passing it to `decimalFrom`.

- [ ] **Step 1: Write failing grouping and funding tests**

  Cover:

  - trim/uppercase normalization, invalid labels, duplicates, sorted output, and preserved group
    order;
  - non-zero equity, balance, and collateral independently marking a currency funded;
  - exact `0`, `+0.0`, `-0`, null, and malformed values not marking it funded;
  - positive and negative non-zero values marking it funded;
  - a tiny exact value such as `1e-4000` marking it funded, proving there is no `Number` underflow;
  - `availableFunds`, margins, withdrawal funds, and P&L not determining funding.

- [ ] **Step 2: Write failing resolution tests**

  Cover:

  - BNB zero + BTC funded resolves BTC regardless of component order;
  - a present saved USDC resolves even when zero;
  - both `client` and `admin` provenance are preserved;
  - multiple funded, no funded, and valid-saved-but-missing states return the exact reason;
  - inference never mutates input and exposes no persistence behavior;
  - invalid persisted and component labels never become choices or active currencies.

- [ ] **Step 3: Write failing metric-resolution tests**

  Cover scope priority per field, fallback to a remaining same-currency component, values coming
  from different same-currency components, no summation, no cross-currency fallback, canonical
  currency matching, and null when the field is unavailable.

- [ ] **Step 4: Write failing historical-series tests**

  Cover selected-currency isolation, null gaps, ascending timestamps, deterministic duplicate
  handling, latest-summary append only when absent, no overwrite at an equal timestamp, and use
  of the same field precedence as current metrics.

- [ ] **Step 5: Verify the tests fail for missing behavior**

  ```bash
  npx vitest run src/features/clientPortal/dashboard/__tests__/accountCurrency.test.ts
  ```

  Expected: failure because the new module/exports do not exist.

- [ ] **Step 6: Implement the minimum pure module**

  Keep it React-free and side-effect-free. Never write persistence, log summary values, or access
  the network. Convert exact decimals to JavaScript numbers only when constructing Recharts data,
  after validation and metric resolution.

- [ ] **Step 7: Domain gate and main-agent review**

  ```bash
  npx vitest run src/features/clientPortal/dashboard/__tests__/accountCurrency.test.ts
  npm run typecheck
  git diff --check
  ```

  The main agent verifies the frozen exports, exact-decimal path, order independence, absence of
  cross-currency arithmetic, and deterministic history behavior before unlocking Tasks 2 and 3.

- [ ] **Step 8: Main-agent commit**

  ```bash
  git add src/features/clientPortal/dashboard/accountCurrency.ts \
    src/features/clientPortal/dashboard/__tests__/accountCurrency.test.ts
  git commit -m "feat: add account currency resolution"
  ```

---

## Task 2: Adapt the Account currency selector

**Owner:** Selector sub-agent, parallel with Task 3 after Task 1 passes. Main agent reviews and
commits the combined parallel wave.

**Files:**

- Modify: `src/features/clientPortal/components/ReportingCurrencySelector.tsx`
- Modify: `src/features/clientPortal/components/__tests__/ReportingCurrencySelector.test.tsx`

Keep the component filename and internal persistence vocabulary to avoid a broad rename. Replace
the duplicate `reportingCurrenciesFromSummary` decision path with the frozen domain resolution
data.

**Target props:**

```ts
type ReportingCurrencySelectorProps = {
  resolution: AccountCurrencyResolution
  reportingCurrency: string | null
  reportingCurrencySource: ReportingCurrencySource
  saving?: boolean
  error?: string | null
  presentation?: 'compact' | 'configuration'
  onSave: (currency: string | null) => void
}
```

The active/draft value is the valid persisted currency when present, otherwise the inferred
currency for a resolved inferred state, otherwise empty. The component must not call `onSave`
from an effect.

- [ ] **Step 1: Rewrite tests first**

  Add or update tests for:

  - visible “Account currency” copy and `aria-label="Account currency"`;
  - funded currencies first alphabetically, followed by other available currencies;
  - inferred active value plus “Detected from funded balance” and no save on render;
  - the three reason-specific selection-required messages before the control in DOM order;
  - present zero-valued saved selection;
  - absent saved choice visible as disabled context but not resaveable;
  - client/admin provenance and admin-to-client takeover;
  - save restricted to `availableCurrencies`, duplicate-submit prevention, clear, and inline error;
  - venue-native/no-conversion explanatory copy.

- [ ] **Step 2: Run the selector test and confirm expected failures**

  ```bash
  npx vitest run src/features/clientPortal/components/__tests__/ReportingCurrencySelector.test.tsx
  ```

- [ ] **Step 3: Implement both presentations**

  `compact` fits beside Venue and Refresh in a resolved dashboard header. `configuration` renders
  the message and selector as the selection-required card. Reuse one draft/save state machine so
  the two presentations cannot drift.

- [ ] **Step 4: Focused selector gate**

  ```bash
  npx vitest run \
    src/features/clientPortal/dashboard/__tests__/accountCurrency.test.ts \
    src/features/clientPortal/components/__tests__/ReportingCurrencySelector.test.tsx
  npm run typecheck
  git diff --check
  ```

  Report results to the main agent; do not commit.

---

## Task 3: Preserve historical gaps in the chart path

**Owner:** Chart sub-agent, parallel with Task 2 after Task 1 passes. Main agent reviews and
commits the combined parallel wave.

**Files:**

- Modify: `src/features/clientPortal/components/charts/AreaChart.tsx`
- Modify: `src/features/clientPortal/components/charts/HubPerformanceTrends.tsx`
- Modify: `src/features/clientPortal/components/__tests__/AreaChart.test.tsx`
- Create: `src/features/clientPortal/components/__tests__/HubPerformanceTrends.test.tsx`

- [ ] **Step 1: Write the failing `AreaChart` gap test**

  Pass `[number, null, number]`, verify rendering does not throw, and—where exposed by the Recharts
  mock—assert `connectNulls={false}`. Also cover zero-baseline calculations with null-only or mixed
  data so `Math.min`/`Math.max` never receive null as a numeric value.

- [ ] **Step 2: Write failing `HubPerformanceTrends` tests**

  Cover:

  - explicit `currency` prop rather than a selected component;
  - current headline values resolved through `resolveCurrencyMetric`;
  - history `[value, null, value]` preserved and passed to the chart;
  - two non-null values enabling a chart while one numeric point plus nulls shows the placeholder;
  - currency changes rebuilding every series and headline without cross-currency fallback.

- [ ] **Step 3: Confirm the chart tests fail**

  ```bash
  npx vitest run \
    src/features/clientPortal/components/__tests__/AreaChart.test.tsx \
    src/features/clientPortal/components/__tests__/HubPerformanceTrends.test.tsx
  ```

- [ ] **Step 4: Make `AreaChart` null-aware**

  Accept `Array<{ t: string; v: number | null }>` without widening the existing synthetic
  `SeriesPoint` type globally. Derive zero-domain and cross-zero checks from numeric values only.
  Set `connectNulls={false}` explicitly on `<Area>` and keep number-only callers source-compatible.

- [ ] **Step 5: Replace component-based trend selection**

  Remove `componentAtSnapshot`, `hubMetricSeries`, and the `component` prop. Accept
  `{ history, current, currency }`, resolve current values with `resolveCurrencyMetric`, and build
  every series with `buildCurrencyMetricSeries`.

- [ ] **Step 6: Focused chart gate**

  ```bash
  npx vitest run \
    src/features/clientPortal/dashboard/__tests__/accountCurrency.test.ts \
    src/features/clientPortal/components/__tests__/AreaChart.test.tsx \
    src/features/clientPortal/components/__tests__/HubPerformanceTrends.test.tsx
  npm run typecheck
  git diff --check
  ```

  Report results to the main agent; do not commit.

- [ ] **Step 7: Parallel-wave integration gate and main-agent commit**

  After both Tasks 2 and 3 are complete, the main agent inspects both diffs and runs:

  ```bash
  npx vitest run \
    src/features/clientPortal/dashboard/__tests__/accountCurrency.test.ts \
    src/features/clientPortal/components/__tests__/ReportingCurrencySelector.test.tsx \
    src/features/clientPortal/components/__tests__/AreaChart.test.tsx \
    src/features/clientPortal/components/__tests__/HubPerformanceTrends.test.tsx
  npm run typecheck
  git diff --check
  ```

  Then commit both disjoint slices together:

  ```bash
  git add \
    src/features/clientPortal/components/ReportingCurrencySelector.tsx \
    src/features/clientPortal/components/__tests__/ReportingCurrencySelector.test.tsx \
    src/features/clientPortal/components/charts/AreaChart.tsx \
    src/features/clientPortal/components/charts/HubPerformanceTrends.tsx \
    src/features/clientPortal/components/__tests__/AreaChart.test.tsx \
    src/features/clientPortal/components/__tests__/HubPerformanceTrends.test.tsx
  git commit -m "feat: add account currency controls and chart gaps"
  ```

---

## Task 4: Integrate resolution and persistence into the dashboard

**Owner:** Main agent, after both parallel sub-agents stop.

**Files:**

- Modify: `src/features/clientPortal/components/HubPortfolioView.tsx`
- Modify: `src/features/clientPortal/components/__tests__/HubPortfolioView.test.tsx`
- Modify: `src/features/clientPortal/ClientPortalShell.tsx`
- Modify: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
- Modify only if user-visible errors are asserted: `src/features/clientPortal/usePortfolioDataHub.ts`
- Modify only if corresponding copy is surfaced here: `src/lib/clientPortal/reportingCurrencyRepo.ts`
- Test only if copy changes: `src/features/clientPortal/__tests__/useReportingCurrencySelection.test.tsx`

**`HubDashboard` prop additions:**

```ts
onSaveAccountCurrency: (currency: string | null) => void
accountCurrencySaving?: boolean
accountCurrencyError?: string | null
```

- [ ] **Step 1: Replace dashboard tests before implementation**

  Remove the obsolete assertion that a configured currency is ignored. Add fixtures/tests for:

  - alphabetically earlier zero BNB plus funded BTC displaying BTC;
  - the same components in a different order producing the same output;
  - saved USDC displaying USDC even when zero;
  - multiple funded, no funded, and missing saved states rendering the reason-specific card;
  - no currency-dependent KPI, risk, or trend leakage in selection-required states;
  - Equity and Balance resolving from different same-currency components;
  - every KPI/risk/trend label using the one active currency;
  - current values remaining visible when history fails;
  - inferred caption and no save callback during initial render;
  - changing the selected currency and receiving a refreshed overview updating all sections.

- [ ] **Step 2: Replace shell tests before implementation**

  Extend the `usePortfolioDataHub` module mock with `useReportingCurrencySelection`. Verify:

  - the ready dashboard receives the hook's `save`, `saving`, and `error` values;
  - a client selection calls the hook callback with exactly the selected API-reported currency;
  - sole-funded inference performs no save;
  - successful save continues to trigger `reloadHub`, and the refreshed overview remains the
    source of truth.

- [ ] **Step 3: Confirm the integration tests fail**

  ```bash
  npx vitest run \
    src/features/clientPortal/components/__tests__/HubPortfolioView.test.tsx \
    src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
  ```

- [ ] **Step 4: Integrate the resolver into `HubDashboard`**

  Remove `primaryApiComponent`, `apiValueForCurrency`, the first-component fallback, and the
  passive Currency badge. Resolve once from `overview.summary.components`,
  `overview.reportingCurrency`, and `overview.reportingCurrencySource`.

  In a resolved state:

  - render the compact Account currency selector beside Venue and Refresh;
  - use `resolveCurrencyMetric` independently for every performance and risk field;
  - pass the active currency to `HubPerformanceTrends`;
  - retain current KPIs and the neutral history-error message if history is unavailable.

  In a selection-required state:

  - render the configuration selector/card after provenance;
  - render no Performance, Performance trend, or Risk section;
  - keep provenance, native positions, raw summary details, and ledger navigation available.

- [ ] **Step 5: Wire the existing persistence hook in `ClientPortalShell`**

  Call `useReportingCurrencySelection(reloadHub)` unconditionally alongside the Hub data hook so
  hook order is stable. Pass its return values into `HubDashboard`. Do not copy saved currency
  into local dashboard state; wait for the refreshed server overview.

- [ ] **Step 6: Update scoped user-visible error copy if needed**

  Change “reporting currency” to “account currency” only in client-visible errors reached from
  this selector. Preserve hook, repository, RPC, database, and admin terminology. Update the
  corresponding test strings if this optional step is taken.

- [ ] **Step 7: Integration gate**

  ```bash
  npx vitest run \
    src/features/clientPortal/dashboard/__tests__/accountCurrency.test.ts \
    src/features/clientPortal/components/__tests__/ReportingCurrencySelector.test.tsx \
    src/features/clientPortal/components/__tests__/AreaChart.test.tsx \
    src/features/clientPortal/components/__tests__/HubPerformanceTrends.test.tsx \
    src/features/clientPortal/components/__tests__/HubPortfolioView.test.tsx \
    src/features/clientPortal/__tests__/ClientPortalShell.test.tsx \
    src/features/clientPortal/__tests__/useReportingCurrencySelection.test.tsx
  npm run typecheck
  git diff --check
  ```

- [ ] **Step 8: Main-agent commit**

  ```bash
  git add \
    src/features/clientPortal/components/HubPortfolioView.tsx \
    src/features/clientPortal/components/__tests__/HubPortfolioView.test.tsx \
    src/features/clientPortal/ClientPortalShell.tsx \
    src/features/clientPortal/__tests__/ClientPortalShell.test.tsx \
    src/features/clientPortal/usePortfolioDataHub.ts \
    src/lib/clientPortal/reportingCurrencyRepo.ts \
    src/features/clientPortal/__tests__/useReportingCurrencySelection.test.tsx
  git commit -m "feat: scope dashboard to the account currency"
  ```

  Before running this exact `git add`, omit optional files that were not changed.

---

## Task 5: Acceptance audit with a read-only sub-agent

**Owner:** One review sub-agent, read-only. Main agent makes corrections.

Give the reviewer the approved design, the commits from Tasks 1–4, and this checklist. Ask it to
report findings by severity with file and line references, and explicitly to make no edits.

- [ ] **Step 1: Audit behavioral correctness**

  Verify all 14 acceptance criteria in the design, with special attention to:

  - BNB/BTC order independence;
  - no persistence during inference;
  - a zero-valued persisted choice winning;
  - no values or charts in selection-required states;
  - no summation, FX, or cross-currency fallback;
  - field-specific current and historical precedence;
  - null chart gaps and history failure remaining non-blocking.

- [ ] **Step 2: Audit security and scope**

  Verify that the client still writes only through `set_own_reporting_currency`, selectable saves
  are constrained to latest-summary currencies, no account IDs or payload values are newly logged,
  and no database/Hub/admin/positions/ledger behavior changed.

- [ ] **Step 3: Main-agent correction loop**

  Reproduce every substantive finding, add or tighten a regression test first, then make the
  smallest scoped correction. Rerun the Task 4 integration gate after each correction batch.

---

## Task 6: Full verification, documentation, and handoff

**Owner:** Main agent

- [ ] **Step 1: Run the full automated gate**

  ```bash
  npm test
  npm run typecheck
  npm run build
  git diff --check
  ```

  Expected: all commands exit 0.

- [ ] **Step 2: Perform focused browser verification**

  Against the local portal, verify at minimum:

  - a Deribit summary containing zero BNB and funded BTC defaults to BTC;
  - two funded currencies show the configuration card and no currency-dependent values;
  - saving a choice refreshes into the server-returned selection;
  - a stale saved currency fails closed;
  - an intermittent historical currency/metric gap is visibly disconnected;
  - current KPIs remain visible when history is unavailable;
  - the header remains usable at narrow and wide viewport widths.

  Do not mutate production data for this check; use existing local fixtures/mocks or a designated
  development account.

- [ ] **Step 3: Confirm the diff stays within scope**

  ```bash
  git status --short
  git diff --stat
  git diff --check
  ```

  Confirm there is no migration, local FX calculation, Hub contract change, unrelated formatting,
  or accidental modification to positions/ledger units.

- [ ] **Step 4: Commit planning/test follow-ups if still uncommitted**

  ```bash
  git add \
    docs/superpowers/specs/2026-09-04-dashboard-account-currency-selection-design.md \
    docs/superpowers/plans/2026-09-04-dashboard-account-currency-selection.md
  git commit -m "docs: specify account currency dashboard behavior"
  ```

  Include any reviewed test-only correction in an appropriately named separate commit. Do not
  amend or rewrite user-owned commits unless explicitly requested.

- [ ] **Step 5: Handoff summary**

  Report:

  - resolved behavior and user-visible changes;
  - files and commits created;
  - focused and full verification results;
  - review-sub-agent findings and their disposition;
  - any remaining rollout observation, especially accounts with multiple funded currencies or
    stale persisted choices.

## Done criteria

The work is complete only when:

- the sole-funded currency is order-independent and inference causes no write;
- persisted choices, ambiguity, no-funding, and stale-selection states match the approved design;
- every currency-dependent metric and chart uses the same active currency without arithmetic;
- historical missing data renders as gaps;
- persistence, provenance, RLS, and audit behavior remain intact;
- the focused tests, full test suite, typecheck, build, and final read-only audit pass.
