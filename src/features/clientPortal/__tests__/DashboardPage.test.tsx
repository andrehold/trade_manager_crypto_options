import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardPage } from '../pages/DashboardPage'
import { EMPTY_SETUP_STATUS } from '../setupStatus'
import type { Position } from '@/utils'

const positions = [{
  id: 'p1', underlying: 'BTC', programName: 'Weekend Vol', exchange: 'deribit',
  expiryISO: '2025-12-14', dte: 1, status: 'open', netPremium: 0.004, realizedPnl: 0.001,
  strategy: 'Iron Condor', structureId: 's1', legs: [],
} as unknown as Position]

describe('DashboardPage', () => {
  it('shows KPIs and an outstanding setup item', () => {
    render(<DashboardPage positions={positions} setupStatus={EMPTY_SETUP_STATUS} onNavigate={() => {}} />)
    expect(screen.getByText(/equity/i)).toBeInTheDocument()
    expect(screen.getByText(/open positions/i)).toBeInTheDocument()
    expect(screen.getByText(/appropriateness/i)).toBeInTheDocument()
  })
})
