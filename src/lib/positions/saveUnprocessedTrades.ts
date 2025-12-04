import type { SupabaseClient } from '@supabase/supabase-js'
import type { TxnRow } from '@/utils'
import type { SupabaseClientScope } from './clientScope'
import { deriveSyntheticDeliveryTradeId, extractIdentifier } from './identifiers'

export type SaveUnprocessedTradesParams = {
  rows: TxnRow[]
  clientScope?: SupabaseClientScope
  createdBy?: string | null
}

export type SaveUnprocessedTradesResult = { ok: true; inserted: number } | { ok: false; error: string }

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
    return { ok: true, inserted: 0 }
  }

  const clientName = params.clientScope?.clientName?.trim() ?? null
  const createdBy = params.createdBy ?? null

  const payload = rows.map((row) => {
    const orderId = extractIdentifier(row, 'order')
    const tradeIdFromRow = extractIdentifier(row, 'trade')
    const tradeId = tradeIdFromRow ?? deriveSyntheticDeliveryTradeId(row, row as Record<string, unknown>) ?? orderId

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

  const { error } = await client.from('unprocessed_imports').insert(payload)
  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, inserted: payload.length }
}
