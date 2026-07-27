import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarginUsageCard } from '../MarginUsageCard'
import type { MarginUsage } from '../../dashboard/marginModel'

const margin: MarginUsage = {
  imUtilization: 0.31, initialMargin: 818, maintenanceMargin: 406,
  marginBalance: 2620, available: 1802, ccy: 'USDC', zone: 'ok',
}

describe('MarginUsageCard', () => {
  it('leads with the IM utilization percent and lists the amounts in the margin currency', () => {
    render(<MarginUsageCard margin={margin} />)
    expect(screen.getByText('31%')).toBeInTheDocument()
    expect(screen.getByText(/Initial Margin/)).toBeInTheDocument()
    expect(screen.getByText(/2,620 USDC/)).toBeInTheDocument()
    expect(screen.getByText(/1,802 USDC/)).toBeInTheDocument()
  })
  it('reflects the utilization zone as a data attribute for styling', () => {
    render(<MarginUsageCard margin={{ ...margin, imUtilization: 0.88, zone: 'high' }} />)
    expect(screen.getByTestId('im-gauge')).toHaveAttribute('data-zone', 'high')
    expect(screen.getByText('88%')).toBeInTheDocument()
  })
})
