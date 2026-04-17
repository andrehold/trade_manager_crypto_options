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
 * Inserts a synthetic lifecycle='close' position row for each open position (satisfying
 * the DB check constraint that requires close_target_structure_id + linked_structure_ids),
 * then sets closed_at on each original open position. The closing rows are tagged
 * '[reconcile_close]' in notes so they are traceable.
 */
export async function massCloseForReconcile(
  client: SupabaseClient,
): Promise<MassCloseResult | MassCloseError> {
  const closedAt = new Date().toISOString()

  const { data: openPositions, error: fetchError } = await client
    .from('positions')
    .select(
      'position_id, underlier, strategy_code, strategy_name, program_id, client_name, options_structure, construction, risk_defined, execution_route, provider',
    )
    .eq('lifecycle', 'open')
    .or('archived.is.null,archived.eq.false')

  if (fetchError) {
    return { ok: false, error: `Failed to fetch open positions: ${fetchError.message}` }
  }

  if (!openPositions || openPositions.length === 0) {
    return { ok: true, closed: 0, closedAt }
  }

  const closingRows = openPositions.map((pos) => ({
    position_id: crypto.randomUUID(),
    underlier: pos.underlier,
    strategy_code: pos.strategy_code ?? null,
    strategy_name: pos.strategy_name ?? null,
    program_id: pos.program_id ?? null,
    client_name: pos.client_name ?? null,
    options_structure: pos.options_structure,
    construction: pos.construction,
    risk_defined: pos.risk_defined ?? false,
    execution_route: pos.execution_route,
    net_fill: 0,
    provider: pos.provider,
    lifecycle: 'close',
    entry_ts: closedAt,
    archived: false,
    notes: '[reconcile_close]',
    close_target_structure_id: pos.position_id,
    linked_structure_ids: [pos.position_id],
  }))

  const { error: insertError } = await client.from('positions').insert(closingRows)
  if (insertError) {
    return { ok: false, error: `Failed to insert closing positions: ${insertError.message}` }
  }

  const updates = openPositions.map((pos) =>
    client.from('positions').update({ closed_at: closedAt }).eq('position_id', pos.position_id),
  )

  const results = await Promise.all(updates)
  const errors = results.filter((r) => r.error)
  if (errors.length > 0) {
    const msgs = errors.map((e) => e.error!.message).join('; ')
    return { ok: false, error: `Failed to set closed_at on ${errors.length} position(s): ${msgs}` }
  }

  return { ok: true, closed: openPositions.length, closedAt }
}
