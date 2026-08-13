import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar, type SidebarProps } from './Sidebar'

function props(overrides: Partial<SidebarProps> = {}): SidebarProps {
  return {
    collapsed: true,
    onToggle: vi.fn(),
    user: { email: 'admin@example.com' },
    btcSpot: null,
    btcSpotUpdatedAt: null,
    isAdmin: true,
    selectedClient: 'DWF',
    clientOptions: ['DWF'],
    onSelectClient: vi.fn(),
    onAddClient: vi.fn(),
    alertsOnly: false,
    onToggleAlertsOnly: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  }
}

describe('Sidebar client management', () => {
  it('keeps client management accessible when the admin sidebar is collapsed', async () => {
    const onAddClient = vi.fn()
    render(<Sidebar {...props({ onAddClient })} />)

    await userEvent.click(screen.getByRole('button', { name: 'Manage clients' }))

    expect(onAddClient).toHaveBeenCalledOnce()
  })

  it('keeps the collapsed client indicator read-only for non-admin users', () => {
    render(<Sidebar {...props({ isAdmin: false })} />)

    expect(screen.queryByRole('button', { name: 'Manage clients' })).toBeNull()
  })
})
