import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResponsibilityStrip } from '../ResponsibilityStrip'

describe('ResponsibilityStrip', () => {
  it('states responsibility and no-advice, and links to the audit log', async () => {
    const onOpenAudit = vi.fn()
    render(<ResponsibilityStrip onOpenAudit={onOpenAudit} />)
    expect(screen.getByText(/regulatory compliance/i)).toBeInTheDocument()
    expect(screen.getByText(/no advice or recommendation/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /audit log/i }))
    expect(onOpenAudit).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /close|dismiss/i })).toBeNull()
  })
})
