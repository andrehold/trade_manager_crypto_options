import type { SupabaseClient } from '@supabase/supabase-js'
import type { Exchange, TxnRow } from '@/utils'
import { parseInstrumentByExchange } from '@/utils'

export type FetchUnprocessedImportsOptions = {
  clientName?: string | null
  exchange?: Exchange
}

export type FetchUnprocessedImportsResult =
  | { ok: true; rows: TxnRow[] }
  | { ok: false; error: string }

export async function fetchUnprocessedImports(
  client: SupabaseClient,
  options: FetchUnprocessedImportsOptions = {},
): Promise<FetchUnprocessedImportsResult> {
  let query = client
    .from('unprocessed_imports')
    .select('id, instrument, side, amount, price, fee, timestamp, trade_id, order_id, client_name, exchange, raw')
    .order('timestamp', { ascending: false })

  if (options.clientName) {
    query = query.eq('client_name', options.clientName)
  }

  if (options.exchange) {
    query = query.eq('exchange', options.exchange)
  }

  const { data, error } = await query

  if (error) {
    return { ok: false, error: error.message }
  }

  if (!data || data.length === 0) {
    return { ok: true, rows: [] }
  }

  const rows: TxnRow[] = data.map((row: any) => {
    const exchange = (row.exchange ?? options.exchange ?? 'deribit') as Exchange
    const parsed = parseInstrumentByExchange(exchange, row.instrument ?? '')
    const rawAction = row.raw?.action as string | undefined

    return {
      instrument: row.instrument ?? '',
      side: row.side ?? 'buy',
      action: rawAction || undefined,
      amount: Number(row.amount) || 0,
      price: Number(row.price) || 0,
      fee: row.fee != null ? Number(row.fee) : undefined,
      timestamp: row.timestamp ?? undefined,
      trade_id: row.trade_id ?? undefined,
      order_id: row.order_id ?? undefined,
      exchange,
      underlying: parsed?.underlying,
      expiry: parsed?.expiryISO,
      strike: parsed?.strike,
      optionType: parsed?.optionType,
    } as TxnRow
  })

  return { ok: true, rows }
}
