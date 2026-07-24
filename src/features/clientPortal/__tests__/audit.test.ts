import { describe, it, expect } from 'vitest'
import { newEvent, SEED_AUDIT_EVENTS } from '../audit'

describe('newEvent', () => {
  it('builds a client event with an ISO timestamp and unique id', () => {
    const a = newEvent('STRATEGY', 'selected module "X"')
    expect(a.actor).toBe('client')
    expect(a.type).toBe('STRATEGY')
    expect(a.detail).toBe('selected module "X"')
    expect(() => new Date(a.ts).toISOString()).not.toThrow()
    const b = newEvent('API_KEY', 'added key')
    expect(a.id).not.toBe(b.id)
  })
  it('accepts a system actor', () => {
    expect(newEvent('EXECUTION', 'closed leg', 'system').actor).toBe('system')
  })
})

describe('SEED_AUDIT_EVENTS', () => {
  it('is a non-empty list of well-formed events', () => {
    expect(SEED_AUDIT_EVENTS.length).toBeGreaterThan(0)
    for (const e of SEED_AUDIT_EVENTS) {
      expect(typeof e.id).toBe('string')
      expect(typeof e.ts).toBe('string')
      expect(['client', 'system']).toContain(e.actor)
    }
  })
})
