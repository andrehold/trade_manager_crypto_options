import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// No Supabase in tests → the fetch effect is skipped and record() only updates the overlay.
vi.mock('@/lib/supabase', () => ({
  hasSupabaseClient: () => false,
  getSupabaseClient: () => { throw new Error('should not be called in this test') },
}))

import { usePositionInterventions } from '../usePositionInterventions'

describe('usePositionInterventions', () => {
  it('optimistically records a platform intervention on the overlay', () => {
    const { result } = renderHook(() => usePositionInterventions('Acme'))
    expect(result.current.interventions.size).toBe(0)
    act(() => { result.current.record('p1', 'modify', { persist: false }) })
    const iv = result.current.interventions.get('p1')
    expect(iv?.source).toBe('platform')
    expect(iv?.action).toBe('modify')
  })
})
