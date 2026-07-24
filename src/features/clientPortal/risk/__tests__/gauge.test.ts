import { describe, it, expect } from 'vitest'
import { paddedDomain, rangeGauge, bandStatus, capStatus, twoStageGauge } from '../gauge'

describe('paddedDomain', () => {
  it('pads 30% of the safe span on each side', () => {
    expect(paddedDomain(-10, 10)).toEqual([-16, 16])
  })
})

describe('rangeGauge', () => {
  it('maps value/safe-zone/zero to clamped percentages', () => {
    const [lo, hi] = paddedDomain(-10, 10)
    const g = rangeGauge(3.2, lo, hi, -10, 10)
    expect(g.markerPct).toBeCloseTo(60, 5)
    expect(g.safeStartPct).toBeCloseTo(18.75, 5)
    expect(g.safeWidthPct).toBeCloseTo(62.5, 5)
    expect(g.zeroPct).toBeCloseTo(50, 5)
  })
  it('clamps out-of-domain markers and omits zero when 0 is outside the domain', () => {
    const g = rangeGauge(50, 0, 10, 0, 10)
    expect(g.markerPct).toBe(100)
    expect(g.zeroPct).toBeCloseTo(0, 5)
    const g2 = rangeGauge(5, 2, 10, 2, 10)
    expect(g2.zeroPct).toBeNull()
  })
})

describe('bandStatus', () => {
  it('flags near when close to a safe-zone edge, ok in the middle, breach outside', () => {
    expect(bandStatus(-8.1, -10, 0)).toBe('near')   // gamma near floor
    expect(bandStatus(3.2, -10, 10)).toBe('ok')     // delta comfortable
    expect(bandStatus(-0.28, -0.5, 0.5)).toBe('ok') // vega comfortable
    expect(bandStatus(0.8, -2, 2)).toBe('ok')       // theta comfortable
    expect(bandStatus(12, -10, 10)).toBe('breach')
  })
})

describe('capStatus', () => {
  it('uses magnitude vs the cap with a 60% near threshold', () => {
    expect(capStatus(3.4, 5)).toBe('near')   // stress worst 3.4 of 5
    expect(capStatus(3.2, 10)).toBe('ok')    // net delta 3.2 of 10
    expect(capStatus(6, 5)).toBe('breach')
  })
})

describe('twoStageGauge', () => {
  it('locates the reduce/stop thresholds and classifies the current value', () => {
    const m = twoStageGauge(6.7, 20, 33, 39.6)
    expect(m.status).toBe('ok')
    expect(m.amberStartPct).toBeCloseTo(50.505, 2)
    expect(m.redStartPct).toBeCloseTo(83.333, 2)
    expect(twoStageGauge(25, 20, 33, 39.6).status).toBe('near')
    expect(twoStageGauge(33, 20, 33, 39.6).status).toBe('breach')
  })
})
