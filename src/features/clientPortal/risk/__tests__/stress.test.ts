import { describe, it, expect } from 'vitest'
import { STRESS_SCENARIO, SPOT_SHOCKS, IV_SHOCKS, worstCell, headroomPct } from '../stress'

describe('stress scenario', () => {
  it('is a 3x3 grid aligned to the shock axes', () => {
    expect(SPOT_SHOCKS).toEqual([10, 0, -10])
    expect(IV_SHOCKS).toEqual([-20, 0, 20])
    expect(STRESS_SCENARIO).toHaveLength(3)
    STRESS_SCENARIO.forEach((row) => expect(row).toHaveLength(3))
  })
  it('finds the worst (most negative) cell', () => {
    const w = worstCell(STRESS_SCENARIO)
    expect(w).toEqual({ row: 2, col: 2, value: -3.4 })
  })
  it('computes headroom against the limit', () => {
    expect(headroomPct(3.4, 5)).toBeCloseTo(1.6, 5)
  })
})
