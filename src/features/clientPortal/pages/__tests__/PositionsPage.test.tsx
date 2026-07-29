import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PositionsPage } from '../PositionsPage'
import { SAMPLE_POSITIONS } from '../../sampleData'
import type { InterventionMap } from '@/lib/positions/interventions'
import type { Position } from '@/utils'

const positions = [{
  id: 'p1', underlying: 'BTC', programName: 'Weekend Vol', exchange: 'deribit',
  expiryISO: '2026-07-31', dte: 4, status: 'open', netPremium: 0.004, realizedPnl: 0.001,
  strategy: 'Iron Condor', structureId: 's1',
  legs: [
    { key: 'p1-54000-P', strike: 54000, optionType: 'P', openLots: [{ qty: 1, price: 0.002, sign: -1 }], realizedPnl: 0.001, netPremium: 0, qtyNet: -1, trades: [] },
    { key: 'p1-56000-C', strike: 56000, optionType: 'C', openLots: [{ qty: 1, price: 0.001, sign: 1 }], realizedPnl: 0, netPremium: 0, qtyNet: 1, trades: [] },
  ],
} as unknown as Position]

describe('PositionsPage', () => {
  it('lists individual options with override controls', async () => {
    const onClose = vi.fn()
    render(<PositionsPage positions={positions} onModify={() => {}} onClose={onClose} />)
    // One row per option, named by venue instrument, no structure/status column
    expect(screen.getByText('BTC-31JUL26-54000-P')).toBeInTheDocument()
    expect(screen.getByText('BTC-31JUL26-56000-C')).toBeInTheDocument()
    expect(screen.queryByText('Iron Condor')).not.toBeInTheDocument()
    expect(screen.queryByText(/status/i)).not.toBeInTheDocument()
    const closeButtons = screen.getAllByRole('button', { name: /^close$/i })
    expect(closeButtons).toHaveLength(2)
    await userEvent.click(closeButtons[0])
    expect(onClose).toHaveBeenCalledWith('p1')
  })

  it('badges every leg of an intervened position and none of the others', () => {
    const map: InterventionMap = new Map([
      ['sample-ic-1', { positionId: 'sample-ic-1', source: 'platform', action: 'modify', ts: '2026-07-29T12:00:00Z' }],
    ])
    render(<PositionsPage positions={SAMPLE_POSITIONS} interventions={map} onModify={() => {}} onClose={() => {}} />)
    expect(screen.getAllByText('Modified')).toHaveLength(SAMPLE_POSITIONS[0].legs.length)
  })

  it('shows no badge when there are no interventions', () => {
    render(<PositionsPage positions={SAMPLE_POSITIONS} onModify={() => {}} onClose={() => {}} />)
    expect(screen.queryByText('Modified')).toBeNull()
  })

  it('passes the parent positionId to onModify', async () => {
    const onModify = vi.fn()
    render(<PositionsPage positions={SAMPLE_POSITIONS} onModify={onModify} onClose={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: /^modify$/i })[0])
    expect(onModify).toHaveBeenCalledWith('sample-ic-1')
  })
})
