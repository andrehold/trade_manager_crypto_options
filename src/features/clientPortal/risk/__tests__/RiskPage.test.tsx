import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RiskPage } from '../RiskPage'
import { DEFAULT_RISK_LIMITS } from '../riskLimits'

describe('RiskPage', () => {
  it('renders the limit cards, TVL note, and stress matrix', () => {
    render(<RiskPage limits={DEFAULT_RISK_LIMITS} onApply={() => {}} />)
    expect(screen.getByRole('heading', { name: /risk & deployment/i })).toBeInTheDocument()
    expect(screen.getByText(/total value locked/i)).toBeInTheDocument()
    expect(screen.getByText('Delta Cash')).toBeInTheDocument()
    expect(screen.getByText('Gamma Cash')).toBeInTheDocument()
    expect(screen.getByText('on breach → rebalance')).toBeInTheDocument()
    expect(screen.getByText(/spot \+10%/i)).toBeInTheDocument()
  })

  it('edits a bound and applies the updated draft', async () => {
    const onApply = vi.fn()
    render(<RiskPage limits={DEFAULT_RISK_LIMITS} onApply={onApply} />)
    const capital = screen.getByLabelText(/capital allocation/i)
    await userEvent.clear(capital)
    await userEvent.type(capital, '0.05')
    await userEvent.click(screen.getByRole('button', { name: /apply deployment/i }))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0].capitalTvlBtc).toBeCloseTo(0.05)
  })
})
