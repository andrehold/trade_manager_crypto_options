import type { SupabaseClient } from '@supabase/supabase-js'

export interface MassCloseResult {
  ok: true
  closed: number
  closedAt: string
}

export interface MassCloseError {
  ok: false
  error: string
}

/**
 * Close all open (non-archived) positions in preparation for a reconciliation import.
 *
 * Sets lifecycle='close', closed_at=now, and appends "[reconcile_close]" to notes.
 * Returns the count of positions closed.
 */
export async function massCloseForReconcile(
  client: SupabaseClient,
): Promise<MassCloseResult | MassCloseError> {
  const closedAt = new Date().toISOString()

  // First, fetch open positions to get their current notes (so we can append)
  const { data: openPositions, error: fetchError } = await client
    .from('positions')
    .select('position_id, notes')
    .eq('lifecycle', 'open')
    .or('archived.is.null,archived.eq.false')

  if (fetchError) {
    return { ok: false, error: `Failed to fetch open positions: ${fetchError.message}` }
  }

  if (!openPositions || openPositions.length === 0) {
    return { ok: true, closed: 0, closedAt }
  }

  // Update each position with appended notes
  const updates = openPositions.map((pos) => {
    const existingNotes = (pos.notes ?? '').trim()
    const newNotes = existingNotes
      ? `${existingNotes} [reconcile_close]`
      : '[reconcile_close]'

    return client
      .from('positions')
      .update({
        lifecycle: 'close',
        closed_at: closedAt,
        notes: newNotes,
      })
      .eq('position_id', pos.position_id)
  })

  // Execute all updates
  const results = await Promise.all(updates)

  const errors = results.filter((r) => r.error)
  if (errors.length > 0) {
    const msgs = errors.map((e) => e.error!.message).join('; ')
    return { ok: false, error: `Failed to close ${errors.length} position(s): ${msgs}` }
  }

  return { ok: true, closed: openPositions.length, closedAt }
}
