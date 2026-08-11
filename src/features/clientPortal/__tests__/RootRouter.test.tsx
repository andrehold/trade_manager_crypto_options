import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const authState = { user: null as unknown, loading: false, supabaseConfigured: true }
const profileQuery = {
  result: { data: { client_name: 'Canonical TwoPrime' }, error: null as { message: string } | null },
}
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => authState }))
vi.mock('@/App', () => ({ default: () => <div data-testid="admin-app" /> }))
vi.mock('../ClientPortalShell', () => ({ ClientPortalShell: ({ clientName }: { clientName: string }) => <div data-testid="client-shell">{clientName}</div> }))
vi.mock('../LoginDoor', () => ({ LoginDoor: ({ role }: { role: string }) => <div data-testid={`door-${role}`} /> }))
vi.mock('@/lib/supabase', () => ({
  hasSupabaseClient: () => authState.supabaseConfigured,
  getSupabaseClient: () => ({
    auth: { signOut: vi.fn() },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => profileQuery.result),
        })),
      })),
    })),
  }),
}))

import { RootRouter } from '@/RootRouter'

beforeEach(() => {
  window.location.hash = ''
  authState.user = null
  authState.loading = false
  authState.supabaseConfigured = false
  profileQuery.result = { data: { client_name: 'Canonical TwoPrime' }, error: null }
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

  it('uses the canonical clients row rather than stale user metadata when Supabase is configured', async () => {
    authState.supabaseConfigured = true
    authState.user = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'client@x.com',
      app_metadata: { client_id: '22222222-2222-4222-8222-222222222222' },
      user_metadata: { client_name: 'Old TwoPrime' },
    }
    render(<RootRouter />)
    expect(screen.queryByTestId('client-shell')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('client-shell')).toHaveTextContent('Canonical TwoPrime'))
    expect(screen.queryByText('Old TwoPrime')).not.toBeInTheDocument()
  })

  it('fails closed when a configured client is missing the trusted client ID', () => {
    authState.supabaseConfigured = true
    authState.user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'client@x.com', app_metadata: {}, user_metadata: { client_name: 'TwoPrime' } }
    render(<RootRouter />)
    expect(screen.getByText(/not linked to a client profile/i)).toBeInTheDocument()
  })

  it('renders the admin app on the admin door', () => {
    window.location.hash = '#/admin'
    render(<RootRouter />)
    expect(screen.getByTestId('admin-app')).toBeInTheDocument()
  })
})
