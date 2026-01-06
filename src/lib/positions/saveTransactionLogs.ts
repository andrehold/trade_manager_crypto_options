import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientScope } from './clientScope'

export type TransactionLogEntry = {
  exchange: string
  raw: Record<string, unknown>
  instrument?: string | null
  timestamp?: string | null
  tradeId?: string | null
  orderId?: string | null
}

export type SaveTransactionLogsParams = {
  entries: TransactionLogEntry[]
  clientScope?: SupabaseClientScope
  createdBy?: string | null
}

export type SaveTransactionLogsResult = { ok: true; inserted: number } | { ok: false; error: string }

function nullifyUndefined<T extends Record<string, unknown>>(row: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    result[key] = value === undefined ? null : value
  }
  return result as T
}

export async function saveTransactionLogs(
  client: SupabaseClient,
  params: SaveTransactionLogsParams,
): Promise<SaveTransactionLogsResult> {
  const entries = params.entries ?? []
  if (entries.length === 0) {
    return { ok: true, inserted: 0 }
  }

  const clientName = params.clientScope?.clientName?.trim() ?? null
  const createdBy = params.createdBy ?? null
  const payload = entries.map((entry) =>
    nullifyUndefined({
      client_name: clientName,
      exchange: entry.exchange,
      trade_id: entry.tradeId ?? null,
      order_id: entry.orderId ?? null,
      instrument: entry.instrument ?? null,
      timestamp: entry.timestamp ?? null,
      raw: nullifyUndefined(entry.raw),
      created_by: createdBy,
    }),
  )

  const chunkSize = 500
  let inserted = 0
  for (let start = 0; start < payload.length; start += chunkSize) {
    const chunk = payload.slice(start, start + chunkSize)
    const { error } = await client.from('transaction_logs').insert(chunk)
    if (error) {
      return { ok: false, error: error.message }
    }
    inserted += chunk.length
  }

  return { ok: true, inserted }
}
