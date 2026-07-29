import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InterventionBadge, formatInterventionTooltip } from '../InterventionBadge'

describe('InterventionBadge', () => {
  it('renders the Modified label and a platform tooltip', () => {
    render(<InterventionBadge intervention={{ positionId: 'p1', source: 'platform', action: 'modify', ts: '2026-07-29T12:03:00Z' }} />)
    const badge = screen.getByText('Modified')
    expect(badge).toBeInTheDocument()
    expect(badge.getAttribute('title')).toMatch(/via the platform/i)
  })

  it('discloses the venue channel in the tooltip', () => {
    const tip = formatInterventionTooltip({ positionId: 'p1', source: 'venue', action: 'close', ts: '2026-07-29T12:03:00Z' })
    expect(tip).toMatch(/directly on venue/i)
  })
})
