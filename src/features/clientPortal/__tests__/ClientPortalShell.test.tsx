import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useClientPositions } from '../useClientPositions'

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
})
