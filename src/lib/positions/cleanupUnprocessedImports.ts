import type { SupabaseClient } from '@supabase/supabase-js'
import type { TxnRow } from '@/utils'

/**
 * Remove rows from `unprocessed_imports` that have been promoted to a structure.
 *
 * 1. Deletes by trade_id (if any).
 * 2. Deletes by order_id (if any).
 * 3. Fallback: for rows that had *neither* trade_id nor order_id, deletes by
 *    matching on the natural key (instrument + timestamp + side + amount + price).
 */
export async function cleanupUnprocessedImports(
  client: SupabaseClient,
  opts: {
    /** The original TxnRow objects (before normalization). */
    rows: TxnRow[]
    /** Extracted trade IDs from normalized rows (parallel array with `rows`). */
    tradeIds: (string | null)[]
    /** Extracted order IDs from normalized rows (parallel array with `rows`). */
    orderIds: (string | null)[]
    clientName: string | null
    restrictByClient: boolean
    logPrefix: string
  },
): Promise<void> {
  const { rows, tradeIds, orderIds, clientName, restrictByClient, logPrefix } = opts

  const promotedTradeIds = tradeIds.filter((id): id is string => id !== null)
  const promotedOrderIds = orderIds.filter((id): id is string => id !== null)

  // ── Delete by trade_id ────────────────────────────────────────────────
  if (promotedTradeIds.length > 0) {
    const q = client.from('unprocessed_imports').delete().in('trade_id', promotedTradeIds)
    const { error } = await (restrictByClient && clientName ? q.eq('client_name', clientName) : q)
    if (error) console.warn(`[${logPrefix}] Failed to clean up unprocessed_imports by trade_id:`, error.message)
  }

  // ── Delete by order_id ────────────────────────────────────────────────
  if (promotedOrderIds.length > 0) {
    const q = client.from('unprocessed_imports').delete().in('order_id', promotedOrderIds)
    const { error } = await (restrictByClient && clientName ? q.eq('client_name', clientName) : q)
    if (error) console.warn(`[${logPrefix}] Failed to clean up unprocessed_imports by order_id:`, error.message)
  }

  // ── Fallback: match on natural key for rows without any ID ────────────
  for (let i = 0; i < rows.length; i++) {
    if (tradeIds[i] || orderIds[i]) continue // already handled above

    const row = rows[i]
    const instrument = row.instrument?.trim()
    if (!instrument) continue // can't match without instrument

    let q = client
      .from('unprocessed_imports')
      .delete()
      .eq('instrument', instrument)
      .eq('side', row.side ?? '')
      .eq('amount', row.amount ?? 0)
      .eq('price', row.price ?? 0)

    const normalizedTs = row.timestamp ? new Date(row.timestamp).toISOString() : null
    if (normalizedTs) q = q.eq('timestamp', normalizedTs)
    else q = q.is('timestamp', null)

    if (restrictByClient && clientName) q = q.eq('client_name', clientName)

    const { error } = await q
    if (error) console.warn(`[${logPrefix}] Failed to clean up unprocessed_imports by natural key:`, error.message)
  }
}
