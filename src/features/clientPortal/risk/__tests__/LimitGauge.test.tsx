import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LimitGauge, TwoStageGauge } from '../LimitGauge'

describe('LimitGauge', () => {
  it('positions the marker and renders labels', () => {
    const { container, getByText } = render(
      <LimitGauge
        model={{ markerPct: 60, safeStartPct: 18.75, safeWidthPct: 62.5, zeroPct: 50 }}
        status="ok" leftLabel="−10%" rightLabel="+10%"
      />,
    )
    expect(getByText('−10%')).toBeInTheDocument()
    expect(getByText('+10%')).toBeInTheDocument()
    const marker = container.querySelector('[data-role="marker"]') as HTMLElement
    expect(marker.style.left).toBe('60%')
    expect(marker.className).toContain('bg-status-success')
  })
})

describe('TwoStageGauge', () => {
  it('renders three zones and a marker', () => {
    const { container } = render(
      <TwoStageGauge
        model={{ markerPct: 16.9, amberStartPct: 50.5, redStartPct: 83.3, status: 'ok' }}
        leftLabel="0" midLabel="reduce" rightLabel="stop"
      />,
    )
    const marker = container.querySelector('[data-role="marker"]') as HTMLElement
    expect(marker.style.left).toBe('16.9%')
  })
})
