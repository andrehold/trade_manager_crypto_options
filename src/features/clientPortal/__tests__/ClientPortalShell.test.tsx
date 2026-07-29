import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useClientPositions } from '../useClientPositions'

// Recharts' ResponsiveContainer measures 0×0 in jsdom; give it a fixed size.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
  }
})

vi.mock('../useClientPositions')
const mockedHook = vi.mocked(useClientPositions)

beforeEach(() => {
  mockedHook.mockReturnValue({ positions: [], loading: false, error: null, reload: vi.fn() })
})

import { ClientPortalShell } from '../ClientPortalShell'

describe('ClientPortalShell', () => {
  it('renders the sidebar, activation control, and the routed page', () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/dashboard" onSignOut={() => {}} />)
    expect(screen.getByText('TwoPrime')).toBeInTheDocument()
    expect(screen.getByText(/^software$/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('routes to Positions from the hash', () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/positions" onSignOut={() => {}} />)
    expect(screen.getByRole('heading', { name: /positions/i })).toBeInTheDocument()
  })

  it('shows an error banner with a working retry when the fetch failed', async () => {
    const reload = vi.fn()
    mockedHook.mockReturnValue({ positions: [], loading: false, error: 'network down', reload })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/positions" onSignOut={() => {}} />)
    expect(screen.getByText(/could not load your positions/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('renders the Risk page and flips the risk setup status on apply', async () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/risk" onSignOut={() => {}} />)
    expect(screen.getByRole('heading', { name: /risk & deployment/i })).toBeInTheDocument()
    // Risk sidebar item shows the amber "attention" dot before applying (no check)
    await userEvent.click(screen.getAllByRole('button', { name: /apply deployment/i })[0])
    // After applying, the activation control's outstanding list no longer includes "Risk limits"
    const activate = screen.getByRole('button', { name: /activate/i })
    expect(activate.getAttribute('title') ?? '').not.toMatch(/risk limits/i)
  })

  it('renders the audit log with seed entries', () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/audit" onSignOut={() => {}} />)
    expect(screen.getByRole('heading', { name: /audit log/i })).toBeInTheDocument()
    expect(screen.getByText(/self-assessment completed & signed/i)).toBeInTheDocument()
  })

  it('enables activation after all four setup preconditions are met', async () => {
    const base = { clientName: 'TwoPrime', program: 'Obsidian Core', onSignOut: () => {} }
    const { rerender } = render(<ClientPortalShell {...base} hash="#/portal/appropriateness" />)
    for (const cb of screen.getAllByRole('checkbox')) await userEvent.click(cb)
    await userEvent.click(screen.getByRole('button', { name: /sign & complete/i }))
    rerender(<ClientPortalShell {...base} hash="#/portal/strategy" />)
    await userEvent.click(screen.getByRole('button', { name: /apply selection/i }))
    rerender(<ClientPortalShell {...base} hash="#/portal/keys" />)
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
    rerender(<ClientPortalShell {...base} hash="#/portal/risk" />)
    await userEvent.click(screen.getAllByRole('button', { name: /apply deployment/i })[0])
    expect(screen.getByRole('button', { name: /^activate$/i })).toBeEnabled()
  })

  it('flags a position as Modified after the client clicks Modify', async () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/positions" onSignOut={() => {}} />)
    expect(screen.queryByText('Modified')).toBeNull()
    await userEvent.click(screen.getAllByRole('button', { name: /^modify$/i })[0])
    expect(screen.getAllByText('Modified').length).toBeGreaterThan(0)
  })
})
