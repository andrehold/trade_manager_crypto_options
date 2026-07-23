import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivationControl } from '../ActivationControl'
import { EMPTY_SETUP_STATUS } from '../setupStatus'

const complete = { appropriateness: true, strategy: true, riskLimits: true, tradingKey: true }

describe('ActivationControl', () => {
  it('disables Activate until all preconditions are met', () => {
    render(<ActivationControl active={false} setupStatus={EMPTY_SETUP_STATUS} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: /activate/i })).toBeDisabled()
  })

  it('enables Activate when setup is complete and toggles', async () => {
    const onToggle = vi.fn()
    render(<ActivationControl active={false} setupStatus={complete} onToggle={onToggle} />)
    const btn = screen.getByRole('button', { name: /activate/i })
    expect(btn).toBeEnabled()
    await userEvent.click(btn)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('shows Deactivate (kill switch) when active', () => {
    render(<ActivationControl active setupStatus={complete} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeEnabled()
    expect(screen.getByText(/^active$/i)).toBeInTheDocument()
  })
})
