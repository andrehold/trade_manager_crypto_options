import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const authState = { user: null as unknown, loading: false, supabaseConfigured: true }
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => authState }))
vi.mock('@/App', () => ({ default: () => <div data-testid="admin-app" /> }))
vi.mock('../ClientPortalShell', () => ({ ClientPortalShell: () => <div data-testid="client-shell" /> }))
vi.mock('../LoginDoor', () => ({ LoginDoor: ({ role }: { role: string }) => <div data-testid={`door-${role}`} /> }))

import { RootRouter } from '@/RootRouter'

beforeEach(() => {
  window.location.hash = ''
  authState.user = null
  authState.loading = false
  vi.stubEnv('VITE_SUPABASE_ADMIN_EMAILS', 'admin@obsidiandesk.com')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('RootRouter', () => {
  it('shows the client login door when unauthenticated on the client door', () => {
    render(<RootRouter />)
    expect(screen.getByTestId('door-client')).toBeInTheDocument()
  })

  it('shows the client shell for an authenticated non-admin user', () => {
    authState.user = { email: 'client@x.com', app_metadata: {}, user_metadata: { client_name: 'TwoPrime' } }
    render(<RootRouter />)
    expect(screen.getByTestId('client-shell')).toBeInTheDocument()
  })

  it('renders the admin app on the admin door', () => {
    window.location.hash = '#/admin'
    render(<RootRouter />)
    expect(screen.getByTestId('admin-app')).toBeInTheDocument()
  })
})
