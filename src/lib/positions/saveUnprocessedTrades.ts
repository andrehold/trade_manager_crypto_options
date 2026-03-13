import type { SupabaseClient } from '@supabase/supabase-js'
import type { TxnRow } from '@/utils'
import type { SupabaseClientScope } from './clientScope'
import { deriveSyntheticDeliveryTradeId, extractIdentifier } from './identifiers'

export type SaveUnprocessedTradesParams = {
  rows: TxnRow[]
  clientScope?: SupabaseClientScope
  createdBy?: string | null
}

export type SaveUnprocessedTradesResult = { ok: true; inserted: number; warnings: string[] } | { ok: false; error: string }

function nullifyUndefined<T extends Record<string, unknown>>(row: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    result[key] = value === undefined ? null : value
  }
  return result as T
}

export async function saveUnprocessedTrades(
  client: SupabaseClient,
  params: SaveUnprocessedTradesParams,
): Promise<SaveUnprocessedTradesResult> {
  const rows = params.rows ?? []
  if (rows.length === 0) {
    return { ok: true, inserted: 0, warnings: [] }
  }

  const warnings: string[] = []

  const clientName = params.clientScope?.clientName?.trim() ?? null
  const createdBy = params.createdBy ?? null

  const payload = rows.map((row) => {
    const orderId = extractIdentifier(row, 'order')
    const tradeIdFromRow = extractIdentifier(row, 'trade')
    const tradeId = tradeIdFromRow ?? deriveSyntheticDeliveryTradeId(row, row as unknown as Record<string, unknown>) ?? orderId

    return nullifyUndefined({
      client_name: clientName,
      trade_id: tradeId,
      order_id: orderId,
      instrument: row.instrument,
      side: row.side,
      amount: row.amount,
      price: row.price,
      fee: row.fee ?? null,
      timestamp: row.timestamp ?? null,
      exchange: row.exchange ?? null,
      raw: row,
      created_by: createdBy,
    })
  })

  // Remove existing rows with matching trade_id / order_id (scoped by client)
  // to prevent duplicates accumulating on repeated imports.
  const tradeIds = payload.map((r) => r.trade_id).filter((id): id is string => id !== null && id !== '')
  const orderIds = payload.map((r) => r.order_id).filter((id): id is string => id !== null && id !== '')

  if (tradeIds.length > 0) {
    let q = client.from('unprocessed_imports').delete().in('trade_id', tradeIds)
    if (clientName) q = q.eq('client_name', clientName)
    const { error: delErr } = await q
    if (delErr) warnings.push(`Failed to remove existing trade_id duplicates: ${delErr.message}`)
  }
  if (orderIds.length > 0) {
    let q = client.from('unprocessed_imports').delete().in('order_id', orderIds)
    if (clientName) q = q.eq('client_name', clientName)
    const { error: delErr } = await q
    if (delErr) warnings.push(`Failed to remove existing order_id duplicates: ${delErr.message}`)
  }

  const { error } = await client.from('unprocessed_imports').insert(payload)
  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, inserted: payload.length, warnings }
}
