import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientSidebar } from '../ClientSidebar'
import { EMPTY_SETUP_STATUS } from '../setupStatus'

describe('ClientSidebar', () => {
  it('renders the grouped nav and routes on click', async () => {
    const onNavigate = vi.fn()
    render(
      <ClientSidebar
        clientName="TwoPrime" program="Obsidian Core" active="dashboard"
        setupStatus={EMPTY_SETUP_STATUS} onNavigate={onNavigate} onSignOut={() => {}}
      />,
    )
    expect(screen.getByText('TwoPrime')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /risk & deployment/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ledger history/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /positions/i }))
    expect(onNavigate).toHaveBeenCalledWith('positions')
  })
})
