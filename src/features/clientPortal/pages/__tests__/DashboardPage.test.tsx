import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DashboardPage } from '../DashboardPage'
import { SAMPLE_POSITIONS, SAMPLE_MARKS } from '../../sampleData'
import { EMPTY_SETUP_STATUS } from '../../setupStatus'

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
  }
})

describe('DashboardPage', () => {
  it('renders the new sections in order: greeks before margin, then charts', () => {
    render(
      <DashboardPage
        positions={SAMPLE_POSITIONS} marks={SAMPLE_MARKS}
        setupStatus={EMPTY_SETUP_STATUS} onNavigate={() => {}}
      />,
    )
    expect(screen.getByText('Portfolio Greeks')).toBeInTheDocument()
    expect(screen.getByText('Margin Usage')).toBeInTheDocument()
    expect(screen.getByText('Performance')).toBeInTheDocument()
    expect(screen.getByTestId('equity-chart')).toBeInTheDocument()
    expect(screen.getByTestId('greek-chart-vega')).toBeInTheDocument()

    // Greeks section appears before Margin section in the DOM.
    const greeks = screen.getByText('Portfolio Greeks')
    const margin = screen.getByText('Margin Usage')
    expect(greeks.compareDocumentPosition(margin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the existing KPI tiles and setup status', () => {
    render(
      <DashboardPage
        positions={SAMPLE_POSITIONS} marks={SAMPLE_MARKS}
        setupStatus={EMPTY_SETUP_STATUS} onNavigate={() => {}}
      />,
    )
    // Scope the KPI assertions to the KPI row — "Equity"/"Margin Balance" text also
    // appears in the charts / margin card, so a page-wide query would be ambiguous.
    const kpiRow = screen.getByTestId('kpi-row')
    expect(within(kpiRow).getByText('Equity')).toBeInTheDocument()
    expect(within(kpiRow).getByText('Open positions')).toBeInTheDocument()
    expect(screen.getByText('Setup status')).toBeInTheDocument()
    // No Margin Balance KPI tile — the margin balance amount only appears inside the margin card.
    expect(within(kpiRow).queryByText('Margin Balance')).toBeNull()
  })
})
