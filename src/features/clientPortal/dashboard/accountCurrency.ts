import type { ReportingCurrencySource } from '@/lib/clientPortal/reportingCurrencyRepo'
import { normalizeReportingCurrency } from '@/lib/clientPortal/reportingCurrencyRepo'
import type { HubSummary, HubSummaryComponent } from '@/lib/portfolioDataHub'
import { decimalFrom } from '@/lib/portfolioDataHub/decimal'
import { exactDecimalSchema, type ExactDecimal } from '@/lib/portfolioDataHub/schemas'

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

const FUNDING_FIELDS = ['equity', 'balance', 'collateral'] as const
const COMPONENT_SCOPE_PRIORITY = [
  'account',
  'margin_account',
  'account_valuation',
  'asset_account',
] as const

export function groupSummaryComponentsByCurrency(
  components: HubSummaryComponent[],
): Map<string, HubSummaryComponent[]> {
  const groups = new Map<string, HubSummaryComponent[]>()
  for (const component of components) {
    const currency = normalizeReportingCurrency(component.currency)
    if (currency === null) continue
    const group = groups.get(currency)
    if (group) group.push(component)
    else groups.set(currency, [component])
  }
  return groups
}

function isNonZeroExactDecimal(value: unknown): boolean {
  const parsed = exactDecimalSchema.safeParse(value)
  return parsed.success && !decimalFrom(parsed.data).isZero()
}

export function fundedCurrenciesFromSummary(
  components: HubSummaryComponent[],
): string[] {
  const funded: string[] = []
  for (const [currency, group] of groupSummaryComponentsByCurrency(components)) {
    const hasFunding = group.some((component) => (
      FUNDING_FIELDS.some((field) => isNonZeroExactDecimal(component[field]))
    ))
    if (hasFunding) funded.push(currency)
  }
  return funded.sort((left, right) => left.localeCompare(right))
}

export function resolveAccountCurrency(
  components: HubSummaryComponent[],
  persistedCurrency: string | null,
  persistedSource: ReportingCurrencySource,
): AccountCurrencyResolution {
  const availableCurrencies = [...groupSummaryComponentsByCurrency(components).keys()]
    .sort((left, right) => left.localeCompare(right))
  const fundedCurrencies = fundedCurrenciesFromSummary(components)
  const savedCurrency = normalizeReportingCurrency(persistedCurrency)
  const hasValidPersistedChoice = savedCurrency !== null
    && (persistedSource === 'client' || persistedSource === 'admin')

  if (hasValidPersistedChoice && availableCurrencies.includes(savedCurrency)) {
    return {
      status: 'resolved',
      currency: savedCurrency,
      source: persistedSource,
      fundedCurrencies,
      availableCurrencies,
    }
  }

  if (hasValidPersistedChoice) {
    return {
      status: 'selection-required',
      reason: 'saved-currency-missing',
      savedCurrency,
      fundedCurrencies,
      availableCurrencies,
    }
  }

  if (fundedCurrencies.length === 1) {
    return {
      status: 'resolved',
      currency: fundedCurrencies[0],
      source: 'inferred',
      fundedCurrencies,
      availableCurrencies,
    }
  }

  return {
    status: 'selection-required',
    reason: fundedCurrencies.length > 1 ? 'multiple-funded' : 'no-funded-currency',
    savedCurrency: null,
    fundedCurrencies,
    availableCurrencies,
  }
}

export function resolveCurrencyMetric(
  components: HubSummaryComponent[],
  currency: string,
  metric: AccountCurrencyMetricKey,
): ExactDecimal | null {
  const canonicalCurrency = normalizeReportingCurrency(currency)
  if (canonicalCurrency === null) return null
  const group = groupSummaryComponentsByCurrency(components).get(canonicalCurrency)
  if (!group) return null

  for (const componentScope of COMPONENT_SCOPE_PRIORITY) {
    const component = group.find((candidate) => (
      candidate.componentScope === componentScope && candidate[metric] != null
    ))
    if (component) return component[metric]
  }

  return group.find((component) => component[metric] != null)?.[metric] ?? null
}

function compareSummary(left: HubSummary, right: HubSummary): number {
  const timeDifference = Date.parse(left.fetchedAt) - Date.parse(right.fetchedAt)
  if (timeDifference !== 0) return timeDifference
  const timestampDifference = left.fetchedAt.localeCompare(right.fetchedAt)
  return timestampDifference !== 0 ? timestampDifference : left.id.localeCompare(right.id)
}

export function buildCurrencyMetricSeries(
  history: HubSummary[],
  current: HubSummary,
  currency: string,
  metric: AccountCurrencyMetricKey,
): CurrencyMetricPoint[] {
  const summariesByTimestamp = new Map<string, HubSummary>()
  for (const historicalSummary of [...history].sort(compareSummary)) {
    // Sorting equal timestamps by ID ascending means the lexicographically greatest
    // summary ID deterministically replaces the earlier candidates.
    summariesByTimestamp.set(historicalSummary.fetchedAt, historicalSummary)
  }
  if (!summariesByTimestamp.has(current.fetchedAt)) {
    summariesByTimestamp.set(current.fetchedAt, current)
  }

  return [...summariesByTimestamp.values()]
    .sort(compareSummary)
    .map((summary) => {
      const value = resolveCurrencyMetric(summary.components, currency, metric)
      return {
        t: summary.fetchedAt,
        v: value === null ? null : decimalFrom(value).toNumber(),
      }
    })
}
