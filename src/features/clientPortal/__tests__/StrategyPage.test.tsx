import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrategyPage } from '../pages/StrategyPage'

describe('StrategyPage', () => {
  it('lists modules without a recommendation and applies a selection', async () => {
    const onSelect = vi.fn()
    render(<StrategyPage selected={null} onSelect={onSelect} />)
    expect(screen.getByText('Weekend Vol (Short-Dated)')).toBeInTheDocument()
    expect(screen.queryByText(/recommended/i)).toBeNull()
    await userEvent.click(screen.getByText('Range Condor'))
    await userEvent.click(screen.getByRole('button', { name: /apply selection/i }))
    expect(onSelect).toHaveBeenCalledWith('Range Condor')
  })
})
