import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PositionsPage } from '../PositionsPage'
import { SAMPLE_POSITIONS } from '../../sampleData'
import type { InterventionMap } from '@/lib/positions/interventions'

describe('PositionsPage', () => {
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
