import { describe, expect, it } from 'vitest'
import { evaluateHubPreflight } from './portfolio-data-hub-preflight.mjs'

const validEnv = {
  PORTFOLIO_DATA_HUB_BASE_URL: 'https://hub.example.test',
  PORTFOLIO_DATA_HUB_API_KEY: 'test-key-that-must-not-appear-in-results',
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
}

describe('Portfolio Data Hub preflight', () => {
  it.each([
    ['HTTPS', 'https://hub.example.test', true],
    ['loopback HTTP', 'http://127.0.0.1:8000', true],
    ['non-loopback HTTP', 'http://hub.example.test', false],
    ['FTP', 'ftp://hub.example.test', false],
  ])('mirrors runtime URL protocol policy for %s', (_label, baseUrl, valid) => {
    const result = evaluateHubPreflight({ ...validEnv, PORTFOLIO_DATA_HUB_BASE_URL: baseUrl })
    expect(result.errors.some((error) => error.includes('must use HTTPS except on loopback'))).toBe(!valid)
  })

  it('requires non-loopback HTTPS in Production', () => {
    const result = evaluateHubPreflight({ ...validEnv, PORTFOLIO_DATA_HUB_BASE_URL: 'https://localhost:8000' }, { production: true })
    expect(result.errors).toContain('Production PORTFOLIO_DATA_HUB_BASE_URL must be a non-loopback HTTPS URL')
  })

  it('never includes secret values in errors or warnings', () => {
    const secret = 'do-not-log-this-secret'
    const result = evaluateHubPreflight({ ...validEnv, PORTFOLIO_DATA_HUB_API_KEY: secret, VITE_PORTFOLIO_DATA_HUB_API_KEY: secret })
    expect([...result.errors, ...result.warnings].join('\n')).not.toContain(secret)
  })

  it('passes valid configuration without claiming live lifetime or key-scope verification', () => {
    const result = evaluateHubPreflight(validEnv)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('rejects Hub credentials exposed through Vite variables', () => {
    const result = evaluateHubPreflight({ ...validEnv, VITE_PORTFOLIO_DATA_HUB_API_KEY: 'secret' })
    expect(result.errors).toContain('VITE_PORTFOLIO_DATA_HUB_API_KEY must not be VITE_-prefixed; Hub settings are server-only')
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it.each(['499', '30001', '1.5', '1e3', 'not-a-timeout'])('rejects invalid analytics timeout %s', (value) => {
    const result = evaluateHubPreflight({ ...validEnv, PORTFOLIO_DATA_HUB_ANALYTICS_TIMEOUT_MS: value })
    expect(result.errors).toContain('PORTFOLIO_DATA_HUB_ANALYTICS_TIMEOUT_MS must be an integer from 500 to 30000')
  })
  it('allows independent valid analytics and snapshot timeouts', () => {
    const result = evaluateHubPreflight({ ...validEnv, PORTFOLIO_DATA_HUB_TIMEOUT_MS: '10000', PORTFOLIO_DATA_HUB_ANALYTICS_TIMEOUT_MS: '30000' })
    expect(result.errors).toEqual([])
  })
})
