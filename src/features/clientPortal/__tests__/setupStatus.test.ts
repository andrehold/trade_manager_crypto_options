import { describe, it, expect } from 'vitest'
import { canActivate, outstandingItems, EMPTY_SETUP_STATUS, type SetupStatus } from '../setupStatus'

const complete: SetupStatus = { appropriateness: true, strategy: true, riskLimits: true, tradingKey: true }

describe('canActivate', () => {
  it('is true only when all four preconditions are met', () => {
    expect(canActivate(complete)).toBe(true)
  })
  it('is false if any precondition is missing', () => {
    expect(canActivate({ ...complete, appropriateness: false })).toBe(false)
    expect(canActivate({ ...complete, strategy: false })).toBe(false)
    expect(canActivate({ ...complete, riskLimits: false })).toBe(false)
    expect(canActivate({ ...complete, tradingKey: false })).toBe(false)
    expect(canActivate(EMPTY_SETUP_STATUS)).toBe(false)
  })
})

describe('outstandingItems', () => {
  it('lists only the incomplete items', () => {
    expect(outstandingItems(complete)).toEqual([])
    expect(outstandingItems({ ...complete, tradingKey: false })).toEqual(['Active trading API key'])
    expect(outstandingItems(EMPTY_SETUP_STATUS)).toHaveLength(4)
  })
})
