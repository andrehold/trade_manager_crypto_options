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
  const restrictByClient = Boolean(clientName) && !params.clientScope?.isAdmin

  const uniqueTradeIds = Array.from(
    new Set(
      entries
        .map((entry) => entry.tradeId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  )
  const uniqueOrderIds = Array.from(
    new Set(
      entries
        .map((entry) => entry.orderId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  )

  const existingTradeIds = new Set<string>()
  const existingOrderIds = new Set<string>()
  const chunkSize = 99

  for (let start = 0; start < uniqueTradeIds.length; start += chunkSize) {
    const chunk = uniqueTradeIds.slice(start, start + chunkSize)
    let query = client
      .from('transaction_logs')
      .select(restrictByClient ? 'trade_id, client_name' : 'trade_id')
      .in('trade_id', chunk)

    if (restrictByClient && clientName) {
      query = query.eq('client_name', clientName)
    }

    const { data, error } = await query
    if (error) {
      return { ok: false, error: error.message }
    }

    for (const entry of data ?? []) {
      const id = typeof entry.trade_id === 'string' ? entry.trade_id.trim() : ''
      if (id) existingTradeIds.add(id)
    }
  }

  for (let start = 0; start < uniqueOrderIds.length; start += chunkSize) {
    const chunk = uniqueOrderIds.slice(start, start + chunkSize)
    let query = client
      .from('transaction_logs')
      .select(restrictByClient ? 'order_id, client_name' : 'order_id')
      .in('order_id', chunk)

    if (restrictByClient && clientName) {
      query = query.eq('client_name', clientName)
    }

    const { data, error } = await query
    if (error) {
      return { ok: false, error: error.message }
    }

    for (const entry of data ?? []) {
      const id = typeof entry.order_id === 'string' ? entry.order_id.trim() : ''
      if (id) existingOrderIds.add(id)
    }
  }

  const seenTradeIds = new Set<string>()
  const seenOrderIds = new Set<string>()

  const filteredEntries = entries.filter((entry) => {
    const tradeId = entry.tradeId?.trim() ?? null
    const orderId = entry.orderId?.trim() ?? null
    const isTradeDuplicate = Boolean(tradeId && (existingTradeIds.has(tradeId) || seenTradeIds.has(tradeId)))
    const isOrderDuplicate = Boolean(orderId && (existingOrderIds.has(orderId) || seenOrderIds.has(orderId)))

    if (tradeId) seenTradeIds.add(tradeId)
    if (orderId) seenOrderIds.add(orderId)

    return !isTradeDuplicate && !isOrderDuplicate
  })

  if (filteredEntries.length === 0) {
    return { ok: true, inserted: 0 }
  }

  const payload = filteredEntries.map((entry) =>
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

  const insertChunkSize = 500
  let inserted = 0
  for (let start = 0; start < payload.length; start += insertChunkSize) {
    const chunk = payload.slice(start, start + insertChunkSize)
    const { error } = await client.from('transaction_logs').insert(chunk)
    if (error) {
      return { ok: false, error: error.message }
    }
    inserted += chunk.length
  }

  return { ok: true, inserted }
}
