# Dashboard Account-Currency Selection

**Date:** 2026-09-04
**Status:** Implemented; live rollout verification pending

## Summary

The Portfolio Data Hub can return summary components for every currency supported by a
venue, including zero-balance assets. The dashboard currently selects the first account-like
component returned by the API. On Deribit this can make an alphabetically early zero-balance
currency such as BNB appear as the dashboard currency even when the client funded the
account in BTC, USDC, or USDT.

The dashboard will adopt a hybrid account-currency policy:

1. A valid persisted client or administrator choice wins.
2. Without a persisted choice, exactly one funded API currency is inferred and displayed.
3. If more than one funded currency exists, the client must choose one.
4. If no funded currency exists, the dashboard does not guess.

The selected currency scopes which venue-native summary component values are displayed. It
does not convert, combine, or calculate values across currencies.

## Product terminology

The UI calls this setting **Account currency**.

- It is the native currency whose account summary is shown on the dashboard.
- It is not a portfolio reporting currency and does not imply currency conversion.
- It is not necessarily the quote or settlement currency of every position.

For backward compatibility, persistence continues to use
`clients.reporting_currency` and `clients.reporting_currency_source`. Renaming these database
columns is outside this change. Code may retain existing repository and RPC names where a
rename would create unnecessary migration risk, while visible copy uses “Account currency.”

## Goals

- Prevent zero-balance venue currencies from becoming the dashboard default because of API
  ordering.
- Show a useful dashboard immediately when the API reports exactly one funded currency.
- Give the client a durable override when more than one funded currency is present or when
  they prefer a different native account view.
- Keep all displayed values and chart points in one API-supplied currency.
- Reuse the existing client/admin persistence, provenance, RLS, and audit trail.

## Non-goals

- Comparing raw amounts across different currencies.
- Calculating USD equivalents in the portal.
- Converting or summing values across currencies.
- Building a portfolio-level base-currency view.
- Automatically changing or persisting a client setting during page load.
- Changing position, ledger, price, quantity, or settlement-currency presentation.
- Adding risk warnings or trading actions.

## Why “highest amount” is not the default rule

Raw amounts are dimensioned values. `1 BTC`, `500 USDC`, and `20 BNB` cannot be ranked by
their numeric magnitudes. Choosing the largest number would produce incorrect and unstable
results.

A largest-USD-equivalent rule is acceptable only if a future Hub contract provides a trusted,
time-aligned normalized valuation for every currency. The portal must not fetch FX prices or
derive those values locally for this feature.

## Definitions

### Canonical currency

A currency is normalized by trimming whitespace and converting to uppercase. It is valid only
when it matches the existing `^[A-Z0-9]{2,12}$` constraint.

### Currency group

All latest-summary components with the same canonical currency form one currency group.
Components are grouped for selection and metric lookup only; their numeric values are never
summed.

### Funding fields

A currency is considered **funded** when at least one component in its group reports a
non-zero value for any of:

- `equity`
- `balance`
- `collateral`

Null, missing, exact zero, negative zero, and malformed values do not make a currency funded.
Exact-decimal parsing must use the existing Decimal-based utilities, never JavaScript float
coercion.

`available_funds`, margin, withdrawal, and P&L fields do not independently determine funding.
They remain displayable once a currency is selected.

### Persisted choice

`overview.reportingCurrency` is the persisted account-currency choice. Its provenance remains
`client`, `admin`, or null through `overview.reportingCurrencySource`.

## Resolution algorithm

The resolver accepts the latest Hub summary components and the persisted choice. It returns a
discriminated result instead of a nullable currency.

```ts
type AccountCurrencyResolution =
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
```

Resolution order:

1. Normalize and group all valid component currencies.
2. Determine funded currencies from the funding fields above.
3. If a persisted currency is valid and present in the latest summary, resolve to it even if
   its current values are zero. An explicit choice must not be silently overridden.
4. If a persisted currency is absent from the latest summary, return
   `selection-required/saved-currency-missing`. Preserve the saved value for context, but do
   not display another currency's values automatically.
5. Without a persisted choice, if exactly one funded currency exists, resolve to it with
   source `inferred`.
6. Without a persisted choice, if multiple funded currencies exist, return
   `selection-required/multiple-funded`.
7. Without a persisted choice and with no funded currency, return
   `selection-required/no-funded-currency`.

Alphabetical order is used only to present choices, never to select one.

The inferred result is ephemeral. Merely viewing the dashboard must not write
`reporting_currency`, change provenance, or create an audit event.

## Metric resolution within the selected currency

For each dashboard metric, resolve one direct API value within the selected currency. Prefer
components in this order:

1. `account`
2. `margin_account`
3. `account_valuation`
4. `asset_account`
5. Any remaining component in API order that directly reports the requested field

The resolver is field-specific. For example, Equity may come from an `account` component
while Balance comes from an `asset_balance` component of the same currency. This is selection,
not arithmetic.

Rules:

- Use only a non-null value directly returned for the selected currency.
- Never substitute a value from another currency.
- Never sum duplicate components.
- Render `—` when no component reports the metric.
- Format the value with the selected canonical currency.

## Dashboard experience

### Resolved state

The dashboard header displays a compact **Account currency** selector alongside Venue and
Refresh. The active currency is visible without opening the selector.

Performance, risk, and historical sections use only that currency:

- Equity
- Realized P&L
- Unrealized P&L
- Balance
- Available Funds
- Initial Margin
- Maintenance Margin
- Collateral
- Available Withdrawal Funds

When the source is inferred, the selector may show a quiet “Detected from funded balance”
caption. It must not imply that the choice has been saved.

### Selection-required state

Do not render KPI values or charts from an arbitrary currency. Replace the currency-dependent
dashboard content with one compact configuration card:

- **Multiple funded currencies:** “Choose the account currency to show on this dashboard.”
- **Saved currency missing:** “Your saved account currency is not present in the latest venue
  summary. Choose an available currency.”
- **No funded currency:** “No funded account currency was detected. Choose a currency to view
  its venue-reported values.”

The selector choices are:

- funded currencies first, alphabetically;
- then other valid API currencies, alphabetically;
- a reported saved choice remains visible even when its current values are zero;
- an absent saved choice appears for context but cannot be re-saved until the API reports it.

Saving a selection resolves the dashboard after the refreshed overview returns. Save failures
leave the prior resolved or selection-required state intact and display the existing inline
error treatment.

### Changing a resolved choice

The client can choose another API-reported currency and save it. The current dashboard remains
visible while the save is in flight. Disable duplicate submissions. On success, refresh the
overview and historical series; the server-returned persisted value remains the source of
truth.

No confirmation dialog is required because the action changes only presentation scope and is
fully audited.

## Persistence and authorization

Reuse the existing infrastructure without a database migration:

- Client save: `public.set_own_reporting_currency(text)`
- Administrator save: `public.admin_set_client_reporting_currency(uuid, text)`
- Stored fields: `clients.reporting_currency`, `clients.reporting_currency_source`
- Audit table and trigger: existing `client_account_config_audit` flow

The browser never writes the `clients` table directly. Client identity continues to come from
trusted `app_metadata.client_id`; the RPC cannot target another client or modify the Hub account
mapping.

The selector must constrain saves to currencies present in the latest summary response. A
server/API refresh after save prevents stale browser state from becoming authoritative.

## Historical charts

Historical data continues to come from:

```http
GET /api/v1/accounts/{account_id}/summaries
  ?fetched_from=<ISO timestamp>
  &fetched_to=<ISO timestamp>
  &limit=200
```

For each snapshot:

1. Normalize component currencies.
2. Resolve the requested metric only within the active account currency using the same
   field-specific component precedence as the latest summary.
3. Preserve a null point when the currency or metric is absent; do not fall back to another
   currency.
4. Sort by `fetched_at` ascending and de-duplicate identical timestamps deterministically.

Charts must render missing points as gaps and must not connect a line across a currency/data
gap. Changing the account currency rebuilds the series from the already fetched history where
possible; the normal overview refresh may refetch the 30-day window for freshness.

The current latest snapshot may be added to the series only when its `fetched_at` timestamp is
not already present. Its values remain direct API fields.

Historical failure remains non-blocking: show current KPI and risk values with the existing
neutral “Historical trends could not be loaded” copy.

## Component and code changes

Create a pure dashboard-domain module, for example
`src/features/clientPortal/dashboard/accountCurrency.ts`, containing:

- `groupSummaryComponentsByCurrency`
- `fundedCurrenciesFromSummary`
- `resolveAccountCurrency`
- `resolveCurrencyMetric`
- `buildCurrencyMetricSeries`

`HubDashboard` consumes the resolution result and no longer calls `primaryApiComponent` or
depends on API array order. `HubPerformanceTrends` receives an explicit active currency and
uses the shared metric resolver so current and historical values follow identical rules.

Adapt the existing `ReportingCurrencySelector` rather than introducing a second persistence
control:

- visible label becomes “Account currency”;
- explanatory copy says values remain venue-native and are not converted;
- choices follow the funded-first ordering above;
- existing save, provenance, stale-selection, and error behaviors remain.

The admin client-management surface can retain “Reporting currency” temporarily if changing
its terminology would broaden this implementation. A later consistency pass may rename its
visible copy without changing storage.

## Loading and refresh behavior

- Initial overview and history loading remain unchanged.
- Currency resolution occurs only after the latest summary has parsed successfully.
- Refresh recomputes inferred candidates from the new latest summary.
- A persisted choice remains authoritative across refreshes while it is present.
- An inferred choice may change after refresh only if no user/admin choice is stored and the
  funded-currency set changes.
- The page must not flicker through the first API currency before resolution completes.

## Accessibility

- The selector retains an explicit accessible label of “Account currency.”
- Source/detection captions are text, not color-only indicators.
- Selection-required messages precede the selector in reading order.
- KPI and chart regions expose the active currency in their labels or surrounding section
  metadata.
- Loading, save-error, and stale-choice states retain semantic status/alert behavior.

## Acceptance criteria

1. Given BNB, BTC, and ETH components where only BTC has non-zero Equity, Balance, or
   Collateral and no saved choice exists, the dashboard displays BTC.
2. Given the same components in any API order, the result remains BTC.
3. Given BTC and USDC both funded and no saved choice, the dashboard displays no
   currency-dependent KPIs until the client chooses.
4. Given a persisted USDC choice present in the latest summary, USDC is displayed even if BTC
   has a larger number or USDC currently reports zero.
5. Given a persisted currency absent from the latest summary, the dashboard does not silently
   fall back and asks for a new selection.
6. Saving BTC through the client selector calls only `set_own_reporting_currency('BTC')`, then
   refreshes from the server-returned overview.
7. Merely inferring the sole funded currency performs no persistence call.
8. Balance can resolve from an `asset_balance` component while Equity resolves from an
   `account` component, provided both are the selected currency.
9. No dashboard metric combines components or currencies.
10. Historical charts contain only the active currency and render missing snapshots as gaps.
11. An unavailable history endpoint does not hide current values.
12. Exact zero, negative zero, null, and malformed values do not mark a currency as funded.
13. Invalid currency labels never appear as choices and cannot be saved.
14. Client/admin provenance and account-config audit behavior remain intact.

## Test plan

### Unit tests

- Currency normalization, grouping, and funded detection.
- Exact-decimal handling for zero, negative zero, positive, and negative values.
- Resolution precedence for persisted, inferred, ambiguous, empty, and stale states.
- Order independence with BNB/BTC/USDC fixture permutations.
- Field-specific component precedence without summation.
- Historical series currency isolation, timestamp sorting, de-duplication, and null gaps.

### Component tests

- Inferred BTC renders BTC-native KPIs and a detected caption.
- Multiple funded currencies render the selection-required card rather than BNB or another
  first item.
- Selector options are funded-first and accessible.
- Save, saving, error, and refreshed-success states preserve the existing behavior.
- Changing currency updates all KPI, risk, and chart labels consistently.

### Boundary and regression tests

- Gateway responses continue to expose only the mapped account's summary/history.
- No Hub account ID or credential enters the browser.
- Existing admin and client reporting-currency RPC acceptance tests continue to pass.
- Position and ledger units remain unchanged.
- Full typecheck, test suite, and production build pass.

## Rollout and observability

This is a portal-only behavior change using existing persistence. No migration or Hub release is
required.

During rollout, verify at least:

- one Deribit account containing many zero currencies and one funded BTC/USDC/USDT currency;
- one account with multiple funded currencies;
- one account with an existing persisted selection;
- one account whose saved currency is absent from the latest summary;
- one 30-day history with intermittent missing selected-currency points.

Do not log account values or component payloads merely for currency resolution. Existing Hub
provenance and error reporting are sufficient; any new diagnostic log should contain only the
resolution status and canonical currency labels.

## Future extension: normalized portfolio currency

A future portfolio-currency feature requires an explicit Hub contract for time-aligned
normalized valuations. When available, it should be a separate concept and selector from
Account currency. This specification deliberately avoids assigning conversion semantics to the
existing stored field.
