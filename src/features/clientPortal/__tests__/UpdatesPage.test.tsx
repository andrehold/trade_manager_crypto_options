import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdatesPage } from '../pages/UpdatesPage'

describe('UpdatesPage', () => {
  it('approves the pending update', async () => {
    const onApprove = vi.fn()
    render(<UpdatesPage onApprove={onApprove} />)
    await userEvent.click(screen.getByRole('button', { name: /approve & install/i }))
    expect(onApprove).toHaveBeenCalledWith('v2.4.1')
    expect(screen.getByText(/installed/i)).toBeInTheDocument()
  })
})
