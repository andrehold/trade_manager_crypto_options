import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GreeksStrip } from '../GreeksStrip'
import { denominationFor } from '../../dashboard/denomination'
import type { PortfolioSummary } from '../../portfolio'

const summary: PortfolioSummary = {
  totalEquity: 0.0262, totalPnl: 0.0081, totalRealized: 0.0063, pnlPct: 30.92,
  delta: 0.0135, gamma: 0.00021, theta: -0.000038, vega: 0.000124, hasAnyMarks: true,
  programName: 'Obsidian Core', exchange: 'deribit', asset: 'BTC',
}

describe('GreeksStrip', () => {
  it('shows all four greeks with their denomination units', () => {
    render(<GreeksStrip summary={summary} denom={denominationFor(summary)} />)
    expect(screen.getByText('Delta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    expect(screen.getByText('Vega')).toBeInTheDocument()
    expect(screen.getByText('Theta')).toBeInTheDocument()
    expect(screen.getByText(/BTC equivalent/)).toBeInTheDocument()
    expect(screen.getAllByText(/USD per/).length).toBe(2)
  })

  it('shows an em-dash for each greek value when there are no live marks', () => {
    const noMarks: PortfolioSummary = {
      ...summary, hasAnyMarks: false, delta: 0, gamma: 0, theta: 0, vega: 0, totalPnl: null,
    }
    render(<GreeksStrip summary={noMarks} denom={denominationFor(noMarks)} />)
    expect(screen.queryByText(/\+0\.0000/)).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBe(4)
  })
})
