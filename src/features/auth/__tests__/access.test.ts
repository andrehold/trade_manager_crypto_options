import { describe, it, expect, vi, afterEach } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { resolveClientAccess } from '../access'

function user(partial: Partial<User> & { email?: string }): User {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    ...partial,
  } as unknown as User
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveClientAccess — admin gating (fail closed)', () => {
  it('treats a user as a CLIENT when the allowlist is empty (no fail-open)', () => {
    vi.stubEnv('VITE_SUPABASE_ADMIN_EMAILS', '')
    expect(resolveClientAccess(user({ email: 'someone@example.com' })).isAdmin).toBe(false)
  })

  it('treats a user as a CLIENT when the allowlist is unset', () => {
    vi.stubEnv('VITE_SUPABASE_ADMIN_EMAILS', undefined as unknown as string)
    expect(resolveClientAccess(user({ email: 'someone@example.com' })).isAdmin).toBe(false)
  })

  it('grants admin when the email is in the allowlist (case-insensitive)', () => {
    vi.stubEnv('VITE_SUPABASE_ADMIN_EMAILS', 'admin@x.com, boss@x.com')
    expect(resolveClientAccess(user({ email: 'Admin@X.com' })).isAdmin).toBe(true)
  })

  it('keeps a non-allowlisted email as a client even when an allowlist is set', () => {
    vi.stubEnv('VITE_SUPABASE_ADMIN_EMAILS', 'admin@x.com')
    expect(resolveClientAccess(user({ email: 'client@x.com' })).isAdmin).toBe(false)
  })

  it('grants admin via app_metadata.role === "admin" regardless of the allowlist', () => {
    vi.stubEnv('VITE_SUPABASE_ADMIN_EMAILS', 'admin@x.com')
    const u = user({ email: 'client@x.com', app_metadata: { role: 'admin' } })
    expect(resolveClientAccess(u).isAdmin).toBe(true)
  })

  it('treats a null user (signed out) as non-admin', () => {
    vi.stubEnv('VITE_SUPABASE_ADMIN_EMAILS', '')
    expect(resolveClientAccess(null).isAdmin).toBe(false)
  })
})

describe('resolveClientAccess — client identity', () => {
  it('extracts client_name from user_metadata', () => {
    vi.stubEnv('VITE_SUPABASE_ADMIN_EMAILS', 'admin@x.com')
    const u = user({ email: 'client@x.com', user_metadata: { client_name: 'TwoPrime' } })
    const access = resolveClientAccess(u)
    expect(access.isAdmin).toBe(false)
    expect(access.clientName).toBe('TwoPrime')
  })
})
