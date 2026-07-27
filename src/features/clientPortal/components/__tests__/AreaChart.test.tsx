import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AreaChart } from '../charts/AreaChart'

// Recharts' ResponsiveContainer measures 0×0 in jsdom; give it a fixed size.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
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
})
