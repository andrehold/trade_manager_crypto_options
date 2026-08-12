import { describe, it, expect } from 'vitest'
import { parseDoor, isPortalRoute, parsePortalPage, portalHash } from '../routing'

describe('parseDoor', () => {
  it('detects the admin door', () => {
    expect(parseDoor('#/admin')).toBe('admin')
    expect(parseDoor('#/admin/login')).toBe('admin')
  })
  it('defaults to the client door', () => {
    expect(parseDoor('#/login')).toBe('client')
    expect(parseDoor('')).toBe('client')
    expect(parseDoor('#/portal/audit')).toBe('client')
  })
})

describe('isPortalRoute', () => {
  it('is true only for #/portal/*', () => {
    expect(isPortalRoute('#/portal')).toBe(true)
    expect(isPortalRoute('#/portal/positions')).toBe(true)
    expect(isPortalRoute('#/login')).toBe(false)
    expect(isPortalRoute('#/admin')).toBe(false)
  })
})

describe('parsePortalPage', () => {
  it('reads the page segment', () => {
    expect(parsePortalPage('#/portal/positions')).toBe('positions')
    expect(parsePortalPage('#/portal/ledger')).toBe('ledger')
    expect(parsePortalPage('#/portal/audit')).toBe('audit')
  })
  it('defaults unknown or missing to dashboard', () => {
    expect(parsePortalPage('#/portal')).toBe('dashboard')
    expect(parsePortalPage('#/portal/nope')).toBe('dashboard')
  })
})

describe('portalHash', () => {
  it('builds a portal hash', () => {
    expect(portalHash('risk')).toBe('#/portal/risk')
    expect(portalHash('ledger')).toBe('#/portal/ledger')
  })
})
