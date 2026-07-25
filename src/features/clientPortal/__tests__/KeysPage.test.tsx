import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeysPage } from '../pages/KeysPage'

describe('KeysPage', () => {
  it('adds a trading key and states no-withdrawal', async () => {
    const onAddKey = vi.fn()
    render(<KeysPage hasActiveKey={false} onAddKey={onAddKey} />)
    expect(screen.getByText(/never holds withdrawal/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
    expect(onAddKey).toHaveBeenCalledWith('Deribit — main')
  })
  it('shows the active key when present', () => {
    render(<KeysPage hasActiveKey onAddKey={() => {}} />)
    expect(screen.getByText(/1 active/i)).toBeInTheDocument()
  })
})
