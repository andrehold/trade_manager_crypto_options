# Portal Dashboard — Expanded KPIs & Charts

**Date:** 2026-07-27
**Surface:** `/portal/dashboard` — `src/features/clientPortal/pages/DashboardPage.tsx`
**Mockup:** https://claude.ai/code/artifact/850bb3ea-9393-40a5-b2b9-d26b23397409

## Goal

Expand the client portal dashboard from four KPI tiles + a setup-status card into a
richer at-a-glance view: margin balance, initial-margin utilization, portfolio
greeks, an equity chart, a PnL chart, and one chart per greek. The dashboard reports,
it does not advise (see [[client-portal-architecture]]).

## Scope

In scope, added to the existing `DashboardPage`. Section order top-to-bottom:

1. **KPI row (unchanged set)** — Equity, Net PnL, PnL %, Open Positions. Equity and
   PnL are the hero metrics; there is **no** Margin Balance KPI tile (the margin
   balance amount lives in the Margin Usage card instead).
2. **Portfolio Greeks strip** — Δ Γ V Θ with values and units. Sits **above** Margin
   Usage.
3. **Margin Usage card** — headline **Initial Margin utilization %** as a color-zoned
   gauge; IM/MM/balance/available amounts shown as a secondary stat list. The
   utilization % is a normal metric size — **not larger than a KPI value** — so it
   doesn't out-shout Equity/PnL.
4. **Equity chart** — area chart, deposit-asset denominated, last 30 days.
5. **PnL chart** — cumulative area chart against a zero baseline.
6. **Per-greek charts** — four small-multiple sparkline/area panels.

Preserved as-is: the Sample-data banner, the "Dashboard" title/subtitle, and the
Setup Status card (rendered last).

Out of scope (explicitly deferred): a live exchange margin feed, persisted
time-series history, and spot-price conversion. These are illustrative in this phase
(decisions confirmed with the user).

## Denomination model (the core design decision)

Each client account has **one deposit/collateral currency**, which is client-specific
and always a currency the venue accepts as margin collateral (a client never deposits
a currency they can't trade with). Reporting rules:

| Metric | Denomination | Rationale |
|---|---|---|
| Equity, Net PnL, PnL % | **Deposit asset** (e.g. BTC) | Clients want reporting in their deposit currency. Matches the current live page. |
| Delta, Gamma | **Deposit asset** (e.g. BTC) | Underlying-linked exposures. |
| Vega, Theta | **USD** | Vol/time exposures are read in cash terms. |
| Margin Balance, IM, MM, Available | **Venue margin currency** (e.g. USDC) | Venue-specific; shown second-tier to utilization. |

- **Margin usage is the headline; the amount is second-tier.** The Margin Usage card
  leads with **IM utilization = Initial Margin ÷ Margin Balance** as a single % with a
  green (0–50) / amber (50–80) / red (80–100) zoned gauge. Amounts are a supporting
  stat list, labelled with the venue margin currency.
- No BTC↔USD conversion is performed for equity/PnL — they stay in the deposit asset.

### Where the currencies come from (illustrative phase)

There is no `depositAsset` / `marginCcy` field on positions or accounts today;
`portfolioSummary` derives `asset` from `positions[0].underlying`. For this phase:

- Deposit asset = existing `asset` from `portfolioSummary` (the underlying).
- Margin currency = a per-venue constant (illustrative default `USDC` for Deribit).
- Margin figures (balance/IM/MM) and Vega/Theta cash values = illustrative props.

A future phase wires a real account/margin feed and, if needed, persists
`depositAsset` + `marginCcy` per account. Components are built to take these as
inputs (props), never hardcoded, so the later swap is a data change, not a UI change.

## Architecture

Keep `DashboardPage` as the composition root; extract presentational pieces so the
file stays focused and each unit is independently testable.

```
DashboardPage (composition + data wiring)
├─ KpiRow            — Equity, Net PnL, PnL %, Open Positions (unchanged set)
├─ GreeksStrip       — Δ Γ V Θ tiles, unit-aware (above Margin Usage)
├─ MarginUsageCard   — IM utilization gauge + amounts stat list
├─ PerformanceCharts — EquityChart + PnlChart (side by side)
├─ GreekCharts       — 4 small-multiple panels
└─ SetupStatusCard   — existing (extracted unchanged, rendered last)
```

New/changed files (final names decided during planning):

- `src/features/clientPortal/pages/DashboardPage.tsx` — compose the above.
- `src/features/clientPortal/components/MarginUsageCard.tsx`
- `src/features/clientPortal/components/GreeksStrip.tsx`
- `src/features/clientPortal/components/charts/` — `AreaChart.tsx` (shared Recharts
  wrapper themed to portal tokens), `EquityChart.tsx`, `PnlChart.tsx`, `GreekCharts.tsx`.
- `src/features/clientPortal/portfolio.ts` — extend `PortfolioSummary` with margin +
  denomination fields (see Data below).
- Illustrative fixtures colocated with the sample-data path already used by the portal.

### Data

Extend `portfolioSummary` output (all optional / illustrative in this phase):

- `depositAsset: string`, `marginCcy: string`
- `marginBalance`, `initialMargin`, `maintenanceMargin`, `available` (margin currency)
- `imUtilization` (0–1, = initialMargin / marginBalance)
- greeks already present; ensure Vega/Theta carry a USD unit label while Δ/Γ carry the
  deposit-asset label.

Chart series (equity, pnl, per-greek) come from an illustrative time-series generator
in this phase, behind the same interface a real snapshot history would satisfy:
`{ t: ISOstring, v: number }[]`.

## Charts

- **Library:** Recharts (new dependency), themed to portal semantic tokens — accent
  `#A16EFF`, deposit-asset series in accent, PnL success/danger, greeks in
  purple/sky/amber/rose (validated CVD-safe against the dark surface).
- Each area chart: recessive gridlines, gradient fill, emphasized endpoint, hover
  crosshair + tooltip. PnL and signed greeks drawn against a dashed zero baseline.
- Per-greek panels are single-series small multiples; identity is carried by the panel
  title (not color alone), so a legend is unnecessary.

## Error / empty / loading states

- **No positions / sample data:** the existing Sample-data banner stays; KPIs and
  charts render illustrative values (as today for the sample path).
- **Marks loading:** greeks and uPnL show a spinner/em-dash exactly as the current page
  does via `markLoading`.
- **No margin data (real phase):** margin card shows "—" and a "not available for this
  venue" note rather than a misleading zero.

## Testing

- `portfolio.ts`: unit tests for the extended summary — IM utilization math, unit
  labelling (Δ/Γ deposit asset vs V/Θ USD), and null-safety when marks/margin absent.
- `MarginUsageCard`: renders the correct gauge zone/color for representative
  utilization values (e.g. 31% → green, 65% → amber, 88% → red).
- Chart components: render without crashing given an empty series and a normal series;
  zero-baseline present when the series crosses zero.
- Keep the existing `ClientPortalShell` / dashboard tests green.

## Phasing

1. **This phase (illustrative):** all UI, denomination-aware, wired to illustrative
   margin + time-series data behind clean prop/interface boundaries. Recharts added.
2. **Later (out of scope here):** real per-account margin feed, persisted snapshot
   history, optional spot conversion — a data-layer swap, no UI rework.
