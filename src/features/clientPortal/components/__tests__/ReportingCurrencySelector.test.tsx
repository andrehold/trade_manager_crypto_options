import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccountCurrencyResolution } from '../../dashboard/accountCurrency'
import { ReportingCurrencySelector } from '../ReportingCurrencySelector'

const resolved = (
  overrides: Partial<Extract<AccountCurrencyResolution, { status: 'resolved' }>> = {},
): Extract<AccountCurrencyResolution, { status: 'resolved' }> => ({
  status: 'resolved',
  currency: 'USDC',
  source: 'client',
  fundedCurrencies: ['BTC', 'USDC'],
  availableCurrencies: ['BNB', 'BTC', 'ETH', 'USDC'],
  ...overrides,
})

const selectionRequired = (
  reason: Extract<AccountCurrencyResolution, { status: 'selection-required' }>['reason'],
  overrides: Partial<Extract<AccountCurrencyResolution, { status: 'selection-required' }>> = {},
): Extract<AccountCurrencyResolution, { status: 'selection-required' }> => ({
  status: 'selection-required',
  reason,
  savedCurrency: null,
  fundedCurrencies: [],
  availableCurrencies: ['BNB', 'BTC', 'ETH', 'USDC'],
  ...overrides,
})

function renderSelector({
  resolution = resolved(),
  reportingCurrency = 'USDC',
  reportingCurrencySource = 'client' as const,
  ...props
}: Partial<React.ComponentProps<typeof ReportingCurrencySelector>> = {}) {
  return render(
    <ReportingCurrencySelector
      resolution={resolution}
      reportingCurrency={reportingCurrency}
      reportingCurrencySource={reportingCurrencySource}
      onSave={() => {}}
      {...props}
    />,
  )
}

describe('ReportingCurrencySelector', () => {
  it('uses Account currency terminology and explains that displayed values remain venue-native', () => {
    renderSelector()

    expect(screen.getByText('Account currency')).toBeInTheDocument()
    expect(screen.getByLabelText('Account currency')).toHaveValue('USDC')
    expect(screen.getByText(/venue-native currency.*not converted or combined/i)).toBeInTheDocument()
  })

  it('orders funded choices first alphabetically, followed by other available currencies', () => {
    renderSelector()

    expect(screen.getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
      'BTC', 'USDC', 'BNB', 'ETH',
    ])
  })

  it('shows an inferred currency as detected without persisting it during render', () => {
    const onSave = vi.fn()
    renderSelector({
      resolution: resolved({ currency: 'BTC', source: 'inferred', fundedCurrencies: ['BTC'] }),
      reportingCurrency: null,
      reportingCurrencySource: null,
      presentation: 'compact',
      onSave,
    })

    expect(screen.getByLabelText('Account currency')).toHaveValue('BTC')
    expect(screen.getByText('Detected from funded balance')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it.each([
    ['multiple-funded', 'Choose the account currency to show on this dashboard.'],
    ['saved-currency-missing', 'Your saved account currency is not present in the latest venue summary. Choose an available currency.'],
    ['no-funded-currency', 'No funded account currency was detected. Choose a currency to view its venue-reported values.'],
  ] as const)('renders the %s configuration message before the control', (reason, message) => {
    renderSelector({
      resolution: selectionRequired(reason, reason === 'saved-currency-missing'
        ? { savedCurrency: 'EUR' }
        : reason === 'multiple-funded'
          ? { fundedCurrencies: ['BTC', 'USDC'] }
          : {}),
      reportingCurrency: reason === 'saved-currency-missing' ? 'EUR' : null,
      reportingCurrencySource: reason === 'saved-currency-missing' ? 'client' : null,
      presentation: 'configuration',
    })

    const messageNode = screen.getByText(message)
    const control = screen.getByLabelText('Account currency')
    expect(messageNode.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps a present zero-valued saved selection active and shows client provenance', () => {
    renderSelector({
      resolution: resolved({ currency: 'USDC', source: 'client', fundedCurrencies: ['BTC'] }),
    })

    expect(screen.getByLabelText('Account currency')).toHaveValue('USDC')
    expect(screen.getByText(/Last set by:/i)).toHaveTextContent('Client')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  it('shows an absent saved choice as disabled context and cannot re-save it', () => {
    renderSelector({
      resolution: selectionRequired('saved-currency-missing', {
        savedCurrency: 'EUR',
        fundedCurrencies: ['BTC'],
        availableCurrencies: ['BTC', 'USDC'],
      }),
      reportingCurrency: 'EUR',
      reportingCurrencySource: 'client',
      presentation: 'configuration',
    })

    expect(screen.getByLabelText('Account currency')).toHaveValue('EUR')
    expect(screen.getByRole('option', { name: /EUR.*not in latest summary/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  it('shows administrator provenance and allows the client to take ownership of the same currency', async () => {
    const onSave = vi.fn()
    renderSelector({
      resolution: resolved({ source: 'admin' }),
      reportingCurrencySource: 'admin',
      onSave,
    })

    expect(screen.getByText(/Last set by:/i)).toHaveTextContent('Administrator')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('USDC')
  })

  it('only saves available currencies and allows an existing selection to be cleared', async () => {
    const onSave = vi.fn()
    renderSelector({
      resolution: selectionRequired('saved-currency-missing', {
        savedCurrency: 'EUR',
        fundedCurrencies: ['BTC'],
        availableCurrencies: ['BTC'],
      }),
      reportingCurrency: 'EUR',
      reportingCurrencySource: 'client',
      presentation: 'configuration',
      onSave,
    })

    await userEvent.selectOptions(screen.getByLabelText('Account currency'), 'BTC')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('BTC')
    await userEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('allows a missing saved choice to be cleared when the latest summary has no currencies', async () => {
    const onSave = vi.fn()
    renderSelector({
      resolution: selectionRequired('saved-currency-missing', {
        savedCurrency: 'EUR',
        availableCurrencies: [],
      }),
      reportingCurrency: 'EUR',
      reportingCurrencySource: 'admin',
      presentation: 'configuration',
      onSave,
    })

    expect(screen.getByLabelText('Account currency')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('permits an inferred currency to be explicitly saved', async () => {
    const onSave = vi.fn()
    renderSelector({
      resolution: resolved({ currency: 'BTC', source: 'inferred', fundedCurrencies: ['BTC'], availableCurrencies: ['BTC'] }),
      reportingCurrency: null,
      reportingCurrencySource: null,
      onSave,
    })

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('BTC')
  })

  it('does not submit a draft value outside the latest available currencies', async () => {
    const onSave = vi.fn()
    renderSelector({ onSave })

    fireEvent.change(screen.getByLabelText('Account currency'), { target: { value: 'DOGE' } })
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('disables duplicate submissions while saving and exposes failures without replacing the active value', () => {
    renderSelector({ saving: true, error: 'RPC denied' })

    expect(screen.getByLabelText('Account currency')).toHaveValue('USDC')
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('RPC denied')
  })
})
