import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppropriatenessPage } from '../pages/AppropriatenessPage'

describe('AppropriatenessPage', () => {
  it('states it is a self-assessment and gives no verdict', () => {
    render(<AppropriatenessPage signed={false} onSign={() => {}} />)
    expect(screen.getByText(/your own assessment/i)).toBeInTheDocument()
    expect(screen.getByText(/does not evaluate, score/i)).toBeInTheDocument()
  })
  it('gates Sign on all attestations and signs', async () => {
    const onSign = vi.fn()
    render(<AppropriatenessPage signed={false} onSign={onSign} />)
    const sign = screen.getByRole('button', { name: /sign & complete/i })
    expect(sign).toBeDisabled()
    for (const cb of screen.getAllByRole('checkbox')) await userEvent.click(cb)
    expect(sign).toBeEnabled()
    await userEvent.click(sign)
    expect(onSign).toHaveBeenCalledOnce()
  })
})
