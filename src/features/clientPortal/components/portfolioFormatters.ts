import { decimalFrom } from '@/lib/portfolioDataHub/decimal'
import type { ExactDecimal } from '@/lib/portfolioDataHub/schemas'

type PortfolioValueKind = 'amount' | 'price' | 'quantity'

const CRYPTO_CURRENCIES = new Set(['BTC', 'ETH'])
const CRYPTO_MINIMUM_FRACTION_DIGITS = 4
const CRYPTO_MAXIMUM_FRACTION_DIGITS = 8
const FIAT_FRACTION_DIGITS = 2

function isCryptoCurrency(currency?: string | null) {
  return currency != null && CRYPTO_CURRENCIES.has(currency.toUpperCase())
}

function addThousandsSeparators(value: string) {
  const [whole, fraction] = value.split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction == null ? '' : `.${fraction}`}`
}

function formatWithFractionRange(value: string, minimumFractionDigits: number, maximumFractionDigits: number) {
  const rounded = decimalFrom(value as ExactDecimal).toDecimalPlaces(maximumFractionDigits)
  const fixed = rounded.toFixed(maximumFractionDigits)
  const [whole, fraction = ''] = fixed.split('.')
  const significantFraction = fraction.replace(/0+$/, '')
  const visibleFraction = significantFraction.length >= minimumFractionDigits
    ? significantFraction
    : fraction.slice(0, minimumFractionDigits)
  return addThousandsSeparators(`${whole}.${visibleFraction}`)
}

/**
 * Formats Hub decimal strings without first converting them to JavaScript numbers.
 * BTC and ETH retain enough precision for native venue values, while USD and
 * reporting amounts retain the conventional two-decimal presentation.
 */
export function formatPortfolioValue(
  value: ExactDecimal | null,
  currency?: string | null,
  kind: PortfolioValueKind = 'amount',
) {
  if (value === null) return '—'

  try {
    const decimal = decimalFrom(value)
    const crypto = isCryptoCurrency(currency)
    const minimumFractionDigits = kind === 'quantity' || crypto ? CRYPTO_MINIMUM_FRACTION_DIGITS : FIAT_FRACTION_DIGITS
    const maximumFractionDigits = kind === 'quantity' || crypto ? CRYPTO_MAXIMUM_FRACTION_DIGITS : FIAT_FRACTION_DIGITS
    const smallestVisible = decimalFrom(`1e-${maximumFractionDigits}` as ExactDecimal)
    const absolute = decimal.abs()

    // A non-zero native crypto value must not appear as a rounded zero.
    if (crypto && !absolute.isZero() && absolute.lessThan(smallestVisible)) {
      const prefix = decimal.isNegative() ? '−' : ''
      const text = `${prefix}<${smallestVisible.toFixed(maximumFractionDigits)}`
      return currency ? `${text} ${currency}` : text
    }

    const rounded = absolute.toDecimalPlaces(maximumFractionDigits)
    const prefix = !rounded.isZero() && decimal.isNegative() ? '−' : ''
    const text = formatWithFractionRange(rounded.toString(), minimumFractionDigits, maximumFractionDigits)
    return currency ? `${prefix}${text} ${currency}` : `${prefix}${text}`
  } catch {
    return currency ? `${value} ${currency}` : value
  }
}
