import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdatesPage } from '../pages/UpdatesPage'

describe('UpdatesPage', () => {
  it('shows the pending update and approves it', async () => {
    const onApprove = vi.fn()
    render(<UpdatesPage approvedVersions={[]} onApprove={onApprove} />)
    expect(screen.getByText(/1 pending your approval/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /approve & install/i }))
    expect(onApprove).toHaveBeenCalledWith('v2.4.1')
  })

  it('renders Installed when the pending version is already approved', () => {
    render(<UpdatesPage approvedVersions={['v2.4.1']} onApprove={() => {}} />)
    expect(screen.getByRole('button', { name: /installed/i })).toBeDisabled()
    expect(screen.queryByText(/1 pending your approval/i)).toBeNull()
  })
})
