import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportingCurrencySelector, reportingCurrenciesFromSummary } from '../ReportingCurrencySelector'

const components = [
  { currency: 'usdc' },
  { currency: 'BTC' },
  { currency: ' USDC ' },
  { currency: '' },
  { currency: 'A' },
  { currency: 'TOO-LONG-CURRENCY' },
  { currency: 'US$' },
] as any

describe('reportingCurrenciesFromSummary', () => {
  it('derives normalized, unique, sorted choices from summary components only and drops invalid Hub labels', () => {
    expect(reportingCurrenciesFromSummary(components)).toEqual(['BTC', 'USDC'])
  })
})

describe('ReportingCurrencySelector', () => {
  it('shows client provenance and saves an available summary currency', async () => {
    const onSave = vi.fn()
    render(<ReportingCurrencySelector components={components} reportingCurrency={null} reportingCurrencySource={null} onSave={onSave} />)
    expect(screen.getByText(/Last set by:/i)).toHaveTextContent('Not configured')
    await userEvent.selectOptions(screen.getByLabelText('Reporting currency'), 'USDC')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('USDC')
  })

  it('shows administrator provenance and allows the client to take ownership of the same currency', async () => {
    const onSave = vi.fn()
    render(<ReportingCurrencySelector components={components} reportingCurrency="USDC" reportingCurrencySource="admin" onSave={onSave} />)
    expect(screen.getByText(/Last set by:/i)).toHaveTextContent('Administrator')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('USDC')
  })

  it('retains and warns about a saved currency absent from the latest summary', () => {
    render(<ReportingCurrencySelector components={components} reportingCurrency="EUR" reportingCurrencySource="client" onSave={() => {}} />)
    expect(screen.getByLabelText('Reporting currency')).toHaveValue('EUR')
    expect(screen.getByRole('status')).toHaveTextContent(/EUR is saved/i)
  })

  it('checks saved-currency availability using the same canonical form as summary extraction', () => {
    render(<ReportingCurrencySelector components={components} reportingCurrency=" usdc " reportingCurrencySource="client" onSave={() => {}} />)
    expect(screen.getByLabelText('Reporting currency')).toHaveValue('USDC')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps an outdated admin selection visible but only permits clearing or choosing a current summary currency', async () => {
    const onSave = vi.fn()
    render(<ReportingCurrencySelector components={components} reportingCurrency="EUR" reportingCurrencySource="admin" onSave={onSave} />)
    expect(screen.getByLabelText('Reporting currency')).toHaveValue('EUR')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /clear/i })).toBeEnabled()
    await userEvent.selectOptions(screen.getByLabelText('Reporting currency'), 'USDC')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
  })

  it('disables new selection when there are no summary currencies but permits clearing the current value', async () => {
    const onSave = vi.fn()
    render(<ReportingCurrencySelector components={[] as any} reportingCurrency="USDC" reportingCurrencySource="client" onSave={onSave} />)
    expect(screen.getByLabelText('Reporting currency')).toBeDisabled()
    expect(screen.getByText(/did not report a selectable currency/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('disables duplicate submissions while saving and exposes failures without replacing the current value', () => {
    render(<ReportingCurrencySelector components={components} reportingCurrency="USDC" reportingCurrencySource="client" saving error="RPC denied" onSave={() => {}} />)
    expect(screen.getByLabelText('Reporting currency')).toHaveValue('USDC')
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('RPC denied')
  })
})
