import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/features/auth/SupabaseLogin', () => ({ SupabaseLogin: () => <div data-testid="supabase-login" /> }))

import { LoginDoor } from '../LoginDoor'

describe('LoginDoor', () => {
  it('renders the client door with the sign-in form and no-advice note', () => {
    render(<LoginDoor role="client" />)
    expect(screen.getByText(/client sign-in/i)).toBeInTheDocument()
    expect(screen.getByTestId('supabase-login')).toBeInTheDocument()
    expect(screen.getByText(/no advice/i)).toBeInTheDocument()
  })
  it('renders the admin door label', () => {
    render(<LoginDoor role="admin" />)
    expect(screen.getByText(/administrator sign-in/i)).toBeInTheDocument()
  })
})
