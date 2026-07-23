import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PositionsPage } from '../pages/PositionsPage'
import type { Position } from '@/utils'

const positions = [{
  id: 'p1', underlying: 'BTC', programName: 'Weekend Vol', exchange: 'deribit',
  expiryISO: '2025-12-14', dte: 1, status: 'open', netPremium: 0.004, realizedPnl: 0.001,
  strategy: 'Iron Condor', structureId: 's1', legs: [],
} as unknown as Position]

describe('PositionsPage', () => {
  it('lists positions with override controls', async () => {
    const onClose = vi.fn()
    render(<PositionsPage positions={positions} onModify={() => {}} onClose={onClose} />)
    expect(screen.getByText('Iron Condor')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(onClose).toHaveBeenCalledWith('p1')
  })
})
