import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuditLogPage } from '../pages/AuditLogPage'
import type { AuditEvent } from '../audit'

const events: AuditEvent[] = [
  { id: '1', ts: '2026-07-23T08:18:20Z', actor: 'client', type: 'ACTIVATION', detail: 'software activated' },
  { id: '2', ts: '2026-07-23T09:00:00Z', actor: 'system', type: 'EXECUTION', detail: 'closed a leg' },
]

describe('AuditLogPage', () => {
  it('renders entries and filters by type', async () => {
    render(<AuditLogPage events={events} />)
    expect(screen.getByText('software activated')).toBeInTheDocument()
    expect(screen.getByText('closed a leg')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^activation$/i }))
    expect(screen.getByText('software activated')).toBeInTheDocument()
    expect(screen.queryByText('closed a leg')).toBeNull()
  })
})
