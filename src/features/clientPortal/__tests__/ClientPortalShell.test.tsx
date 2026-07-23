import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../useClientPositions', () => ({ useClientPositions: () => ({ positions: [], loading: false, error: null, reload: () => {} }) }))

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
})
