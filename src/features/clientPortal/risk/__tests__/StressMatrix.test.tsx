import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StressMatrix } from '../StressMatrix'

describe('StressMatrix', () => {
  it('renders the grid and highlights the worst cell', () => {
    const { container, getByText } = render(<StressMatrix />)
    expect(getByText('IV −20%')).toBeInTheDocument()
    expect(getByText('spot +10%')).toBeInTheDocument()
    const worst = container.querySelector('[data-role="worst"]') as HTMLElement
    expect(worst.textContent).toContain('-3.4')
  })
})
