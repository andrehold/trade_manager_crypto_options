import { describe, expect, it } from 'vitest'
import type { ExactDecimal } from '@/lib/portfolioDataHub/schemas'
import { formatPortfolioValue } from '../portfolioFormatters'

const exact = (value: string) => value as ExactDecimal

describe('formatPortfolioValue', () => {
  it('keeps native BTC and ETH values at a useful precision', () => {
    expect(formatPortfolioValue(exact('0.0525'), 'BTC', 'price')).toBe('0.0525 BTC')
    expect(formatPortfolioValue(exact('0.049'), 'BTC', 'price')).toBe('0.0490 BTC')
    expect(formatPortfolioValue(exact('12.5'), 'BTC', 'quantity')).toBe('12.5000 BTC')
    expect(formatPortfolioValue(exact('0.123456789'), 'ETH')).toBe('0.12345679 ETH')
  })

  it('uses two decimals for USD reporting amounts and avoids negative zero', () => {
    expect(formatPortfolioValue(exact('119250.25'), 'USD', 'price')).toBe('119,250.25 USD')
    expect(formatPortfolioValue(exact('-0.001'), 'USD')).toBe('0.00 USD')
  })

  it('does not render a non-zero native crypto value as zero', () => {
    expect(formatPortfolioValue(exact('0.000000001'), 'BTC')).toBe('<0.00000001 BTC')
    expect(formatPortfolioValue(exact('-0.000000001'), 'BTC')).toBe('−<0.00000001 BTC')
  })
})
