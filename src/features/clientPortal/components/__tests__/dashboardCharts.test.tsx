import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EquityChart } from '../charts/EquityChart'
import { PnlChart } from '../charts/PnlChart'
import { GreekCharts } from '../charts/GreekCharts'
import { denominationFor } from '../../dashboard/denomination'
import type { PortfolioSummary } from '../../portfolio'

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
  }
})

const summary: PortfolioSummary = {
  totalEquity: 0.0262, totalPnl: 0.0081, totalRealized: 0.0063, pnlPct: 30.92,
  delta: 0.0135, gamma: 0.00021, theta: -0.000038, vega: 0.000124, hasAnyMarks: true,
  programName: 'Obsidian Core', exchange: 'deribit', asset: 'BTC',
}

describe('dashboard charts', () => {
  const denom = denominationFor(summary)
  it('EquityChart renders titled equity panel', () => {
    render(<EquityChart summary={summary} denom={denom} />)
    expect(screen.getByText(/equity curve/i)).toBeInTheDocument()
    expect(screen.getByTestId('equity-chart')).toBeInTheDocument()
  })
  it('PnlChart renders titled PnL panel', () => {
    render(<PnlChart summary={summary} denom={denom} />)
    expect(screen.getByText(/cumulative pnl/i)).toBeInTheDocument()
    expect(screen.getByTestId('pnl-chart')).toBeInTheDocument()
  })
  it('GreekCharts renders one panel per greek', () => {
    render(<GreekCharts summary={summary} denom={denom} />)
    for (const name of ['Delta', 'Gamma', 'Vega', 'Theta']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByTestId('greek-chart-delta')).toBeInTheDocument()
  })

  it('PnlChart shows an honest placeholder when there is no PnL yet', () => {
    const noPnl: PortfolioSummary = { ...summary, totalPnl: null, hasAnyMarks: false }
    render(<PnlChart summary={noPnl} denom={denom} />)
    expect(screen.getByText(/awaiting live marks/i)).toBeInTheDocument()
    expect(screen.queryByTestId('pnl-chart')).not.toBeInTheDocument()
  })

  it('GreekCharts honors theta digits (1 decimal) instead of the fmtNumber 2-decimal cap', () => {
    // theta=-0.0001234 * spotUsd(100000) = -12.34 -> digits=1 should render "-12.3", not "-12.34"
    const wide: PortfolioSummary = { ...summary, theta: -0.0001234 }
    render(<GreekCharts summary={wide} denom={denom} />)
    expect(screen.getByText(/−12\.3(?!\d)/)).toBeInTheDocument()
    expect(screen.queryByText(/−12\.34/)).not.toBeInTheDocument()
  })

  it('GreekCharts shows an honest placeholder when there are no live marks', () => {
    const noMarks: PortfolioSummary = {
      ...summary, hasAnyMarks: false, delta: 0, gamma: 0, theta: 0, vega: 0, totalPnl: null,
    }
    render(<GreekCharts summary={noMarks} denom={denom} />)
    expect(screen.getAllByText(/awaiting live marks/i).length).toBe(4)
    expect(screen.queryByTestId('greek-chart-delta')).not.toBeInTheDocument()
  })
})
