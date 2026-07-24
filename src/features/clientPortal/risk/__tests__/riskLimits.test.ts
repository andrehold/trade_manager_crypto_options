import { describe, it, expect } from 'vitest'
import { DEFAULT_RISK_LIMITS, ILLUSTRATIVE_READINGS, activeDeltaBand } from '../riskLimits'

describe('DEFAULT_RISK_LIMITS', () => {
  it('encodes the Weekend Vol defaults', () => {
    expect(DEFAULT_RISK_LIMITS.capitalTvlBtc).toBe(0.03)
    expect(DEFAULT_RISK_LIMITS.deltaShortGamma).toEqual({ min: -10, max: 10 })
    expect(DEFAULT_RISK_LIMITS.deltaLongGamma).toEqual({ min: -60, max: 60 })
    expect(DEFAULT_RISK_LIMITS.gammaFloor).toBe(-10)
    expect(DEFAULT_RISK_LIMITS.gammaCap).toBe(0)
    expect(DEFAULT_RISK_LIMITS.vega).toEqual({ min: -0.5, max: 0.5 })
    expect(DEFAULT_RISK_LIMITS.thetaFloor).toBe(-2)
    expect(DEFAULT_RISK_LIMITS.stressLossMaxPct).toBe(5)
    expect(DEFAULT_RISK_LIMITS.netDeltaMaxPct).toBe(10)
    expect(DEFAULT_RISK_LIMITS.drawdownReducePct).toBe(20)
    expect(DEFAULT_RISK_LIMITS.drawdownStopPct).toBe(33)
  })
})

describe('activeDeltaBand', () => {
  it('selects the short-gamma band when gamma reading is negative', () => {
    const r = activeDeltaBand(DEFAULT_RISK_LIMITS, ILLUSTRATIVE_READINGS)
    expect(ILLUSTRATIVE_READINGS.gammaPct).toBeLessThan(0)
    expect(r.regime).toBe('short')
    expect(r.band).toEqual({ min: -10, max: 10 })
  })
  it('selects the long-gamma band when gamma is positive', () => {
    const r = activeDeltaBand(DEFAULT_RISK_LIMITS, { ...ILLUSTRATIVE_READINGS, gammaPct: 4 })
    expect(r.regime).toBe('long')
    expect(r.band).toEqual({ min: -60, max: 60 })
  })
})
