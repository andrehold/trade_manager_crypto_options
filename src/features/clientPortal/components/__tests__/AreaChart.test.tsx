import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AreaChart } from '../charts/AreaChart'

vi.mock('recharts', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: Wrapper,
    AreaChart: ({ children, data }: { children?: React.ReactNode; data: unknown }) => (
      <div data-testid="recharts-chart" data-series={JSON.stringify(data)}>
        {React.Children.toArray(children).filter((child) => React.isValidElement(child) && child.type !== 'defs')}
      </div>
    ),
    Area: ({ connectNulls }: { connectNulls?: boolean }) => (
      <div data-testid="recharts-area" data-connect-nulls={String(connectNulls)} />
    ),
    XAxis: Wrapper,
    YAxis: ({ domain }: { domain: unknown }) => <div data-testid="recharts-y-axis" data-domain={JSON.stringify(domain)} />,
    CartesianGrid: Wrapper,
    Tooltip: Wrapper,
    ReferenceLine: () => <div data-testid="recharts-reference-line" />,
  }
})

describe('AreaChart', () => {
  it('renders a container for the given series without throwing', () => {
    render(
      <AreaChart
        data={[{ t: '2026-07-01', v: 1 }, { t: '2026-07-02', v: 2 }]}
        color="#A16EFF"
        formatValue={(v) => String(v)}
        testId="area-chart"
      />,
    )
    expect(screen.getByTestId('area-chart')).toBeInTheDocument()
  })

  it('preserves null points as gaps and explicitly prevents Recharts from connecting them', () => {
    const data = [
      { t: '2026-07-01', v: 1 },
      { t: '2026-07-02', v: null },
      { t: '2026-07-03', v: 2 },
    ]
    render(<AreaChart data={data} color="#A16EFF" formatValue={String} />)

    expect(screen.getByTestId('recharts-chart')).toHaveAttribute('data-series', JSON.stringify(data))
    expect(screen.getByTestId('recharts-area')).toHaveAttribute('data-connect-nulls', 'false')
  })

  it('derives the zero baseline from numeric values only', () => {
    const { rerender } = render(
      <AreaChart
        data={[{ t: '2026-07-01', v: null }, { t: '2026-07-02', v: null }]}
        color="#A16EFF"
        zeroBaseline
        formatValue={String}
      />,
    )
    expect(screen.getByTestId('recharts-y-axis')).toHaveAttribute('data-domain', '[0,0]')
    expect(screen.queryByTestId('recharts-reference-line')).toBeNull()

    rerender(
      <AreaChart
        data={[{ t: '2026-07-01', v: -2 }, { t: '2026-07-02', v: null }, { t: '2026-07-03', v: 3 }]}
        color="#A16EFF"
        zeroBaseline
        formatValue={String}
      />,
    )
    expect(screen.getByTestId('recharts-y-axis')).toHaveAttribute('data-domain', '[-2,3]')
    expect(screen.getByTestId('recharts-reference-line')).toBeInTheDocument()
  })
})
