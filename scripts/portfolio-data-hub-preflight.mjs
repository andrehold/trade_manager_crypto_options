#!/usr/bin/env node

/**
 * Checks deployment configuration without contacting the Hub or emitting any
 * values. It is intentionally safe to run in CI logs and on a Vercel build.
 */
export function evaluateHubPreflight(env, { production = false } = {}) {
  const errors = []
  const warnings = []

  function configured(...names) {
    return names.some((name) => Boolean(env[name]?.trim()))
  }

  function fail(message) {
    errors.push(message)
  }

  for (const name of Object.keys(env)) {
    if (name.startsWith('VITE_PORTFOLIO_DATA_HUB_')) {
      fail(`${name} must not be VITE_-prefixed; Hub settings are server-only`)
    }
  }

  const baseUrl = env.PORTFOLIO_DATA_HUB_BASE_URL?.trim()
  if (!baseUrl) {
    fail('PORTFOLIO_DATA_HUB_BASE_URL is required')
  } else {
    try {
      const url = new URL(baseUrl)
      const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      const localHttp = url.protocol === 'http:' && loopback
      if (url.protocol !== 'https:' && !localHttp) {
        fail('PORTFOLIO_DATA_HUB_BASE_URL must use HTTPS except on loopback')
      }
      if (url.username || url.password || url.search || url.hash) {
        fail('PORTFOLIO_DATA_HUB_BASE_URL must not contain credentials, query, or fragment')
      }
      if (production && (url.protocol !== 'https:' || loopback)) {
        fail('Production PORTFOLIO_DATA_HUB_BASE_URL must be a non-loopback HTTPS URL')
      }
    } catch {
      fail('PORTFOLIO_DATA_HUB_BASE_URL must be an absolute URL')
    }
  }

  if (!configured('PORTFOLIO_DATA_HUB_API_KEY')) {
    fail('PORTFOLIO_DATA_HUB_API_KEY is required')
  }

  const timeout = env.PORTFOLIO_DATA_HUB_TIMEOUT_MS?.trim()
  if (timeout && (!/^\d+$/.test(timeout) || Number(timeout) < 500 || Number(timeout) > 30_000)) {
    fail('PORTFOLIO_DATA_HUB_TIMEOUT_MS must be an integer from 500 to 30000')
  }

  if (!configured('SUPABASE_URL', 'VITE_SUPABASE_URL')) {
    fail('SUPABASE_URL or VITE_SUPABASE_URL is required for authenticated Hub routes')
  }
  if (!configured('SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY')) {
    fail('SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_PUBLISHABLE_KEY is required for authenticated Hub routes')
  }

  if (production && env.VERCEL_ENV && env.VERCEL_ENV !== 'production') {
    fail('This production preflight is running outside Vercel Production')
  }
  if (!production && env.VERCEL_ENV === 'preview' && configured('PORTFOLIO_DATA_HUB_API_KEY')) {
    warnings.push('Preview has a Hub key configured; verify it is a distinct read-only staging key, never the Production key')
  }

  return { errors, warnings }
}

function main() {
  const production = process.argv.includes('--production')
  const { errors, warnings } = evaluateHubPreflight(process.env, { production })
  if (errors.length) {
    for (const error of errors) console.error(`Configuration error: ${error}`)
    process.exitCode = 1
  } else {
    console.log(`Portfolio Data Hub ${production ? 'production ' : ''}preflight passed. Values were not printed.`)
  }
  for (const warning of warnings) console.warn(`Configuration warning: ${warning}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
