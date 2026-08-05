import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeysPage } from '../pages/KeysPage'
import type { ExchangeKey } from '@/lib/clientPortal/exchangeKeysRepo'

const KEY: ExchangeKey = { keyRef: 'r1', venue: 'Deribit', label: 'Deribit — main', fingerprint: 'ab12cd', scopes: 'trade,read', noWithdrawal: true, ts: '2026-08-01T00:00:00Z' }

describe('KeysPage', () => {
  it('states no-withdrawal and shows an empty state with no keys', () => {
    render(<KeysPage keys={[]} onAddKey={() => {}} onRevokeKey={() => {}} />)
    expect(screen.getByText(/never holds withdrawal/i)).toBeInTheDocument()
    expect(screen.getByText(/no keys registered yet/i)).toBeInTheDocument()
  })

  it('disables Add until a label is entered and no-withdrawal is attested, then submits the metadata', async () => {
    const onAddKey = vi.fn()
    render(<KeysPage keys={[]} onAddKey={onAddKey} onRevokeKey={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
    const add = screen.getByRole('button', { name: /^add$/i })
    expect(add).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Label'), 'Deribit — main')
    expect(add).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(add).toBeEnabled()
    await userEvent.click(add)
    expect(onAddKey).toHaveBeenCalledWith({ venue: 'Deribit', label: 'Deribit — main', fingerprint: null, noWithdrawal: true })
  })

  it('bounds the fingerprint input to 12 characters so it cannot hold a full API key', async () => {
    render(<KeysPage keys={[]} onAddKey={() => {}} onRevokeKey={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
    expect(screen.getByLabelText('Fingerprint (optional)')).toHaveAttribute('maxlength', '12')
  })

  it('renders an active key and revokes it by keyRef', async () => {
    const onRevokeKey = vi.fn()
    render(<KeysPage keys={[KEY]} onAddKey={() => {}} onRevokeKey={onRevokeKey} />)
    expect(screen.getByText('Deribit — main')).toBeInTheDocument()
    expect(screen.getByText(/1 active/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    expect(onRevokeKey).toHaveBeenCalledWith('r1')
  })
})
