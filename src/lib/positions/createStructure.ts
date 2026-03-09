import type { SupabaseClient } from '@supabase/supabase-js'
import type { TxnRow, Exchange } from '@/utils'
import { parseInstrumentByExchange } from '@/utils'
import { extractIdentifier } from './identifiers'
import type { SupabaseClientScope } from './clientScope'

export type CreateStructureParams = {
  rows: TxnRow[]
  structureType?: string
  exchange?: Exchange
  clientScope?: SupabaseClientScope
  createdBy?: string
}

export type CreateStructureResult =
  | { ok: true; positionId: string; inserted: number }
  | { ok: false; error: string }

function normalizeSide(raw: string | undefined): 'buy' | 'sell' | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (s.startsWith('buy') || s === 'b') return 'buy'
  if (s.startsWith('sell') || s === 's') return 'sell'
  return null
}

function normalizeOptionType(raw: string | undefined): 'call' | 'put' | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (s === 'c' || s === 'call') return 'call'
  if (s === 'p' || s === 'put') return 'put'
  return null
}

function normalizeDateOnly(raw: string | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function normalizeTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString()
  const d = new Date(raw.trim())
  return Number.isNaN(d.getTime()) ? raw.trim() : d.toISOString()
}

function normalizeOpenClose(raw: string | undefined): 'open' | 'close' | null {
  const s = raw?.trim().toLowerCase()
  if (s === 'open' || s === 'close') return s
  return null
}

function toNumeric(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function sanitizeText(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

type NormalizedRow = {
  side: 'buy' | 'sell'
  optionType: 'call' | 'put'
  expiry: string
  strike: number
  qty: number
  price: number
  timestamp: string
  openClose: 'open' | 'close' | null
  tradeId: string | null
  orderId: string | null
  fee: number | null
  notes: string | null
}

function normalizeRow(row: TxnRow, exchange: Exchange): { ok: true; value: NormalizedRow } | { ok: false; error: string } {
  const qty = toNumeric(row.amount)
  if (qty == null || qty === 0) return { ok: false, error: `Missing quantity for ${row.instrument}.` }

  const price = toNumeric(row.price)
  if (price == null) return { ok: false, error: `Missing price for ${row.instrument}.` }

  const side = normalizeSide(row.side as string)
  if (!side) return { ok: false, error: `Missing side for ${row.instrument}.` }

  const parsed = parseInstrumentByExchange(exchange, row.instrument)

  const expiry = normalizeDateOnly(row.expiry) ?? normalizeDateOnly(parsed?.expiryISO)
  if (!expiry) return { ok: false, error: `Missing expiry for ${row.instrument}.` }

  const strike = toNumeric(row.strike ?? parsed?.strike)
  if (strike == null) return { ok: false, error: `Missing strike for ${row.instrument}.` }

  const optionType =
    normalizeOptionType(row.optionType as string | undefined) ??
    normalizeOptionType(parsed?.optionType as string | undefined)
  if (!optionType) return { ok: false, error: `Missing option type for ${row.instrument}.` }

  return {
    ok: true,
    value: {
      side,
      optionType,
      expiry,
      strike,
      qty: Math.abs(qty),
      price,
      timestamp: normalizeTimestamp(row.timestamp),
      openClose: normalizeOpenClose(row.action as string | undefined),
      tradeId: extractIdentifier(row, 'trade'),
      orderId: extractIdentifier(row, 'order'),
      fee: toNumeric(row.fee) ?? null,
      notes: sanitizeText(row.info),
    },
  }
}

export async function createStructure(
  client: SupabaseClient,
  params: CreateStructureParams,
): Promise<CreateStructureResult> {
  const rows = params.rows ?? []
  if (rows.length === 0) {
    return { ok: false, error: 'No rows provided.' }
  }

  const exchange = (params.exchange ?? rows[0]?.exchange ?? 'deribit') as Exchange

  const normalizedRows: NormalizedRow[] = []
  for (const row of rows) {
    const result = normalizeRow(row, exchange)
    if (!result.ok) return { ok: false, error: result.error }
    normalizedRows.push(result.value)
  }

  const positionId = crypto.randomUUID()
  const underlying = rows[0]?.underlying ?? ''
  const strategyCode = params.structureType ?? rows[0]?.structureType ?? null
  const clientName = params.clientScope?.clientName?.trim() || null
  const timestamps = normalizedRows.map((r) => r.timestamp).filter(Boolean).sort()
  const entryTs = timestamps[0] ?? new Date().toISOString()

  const { error: positionError } = await client.from('positions').insert({
    position_id: positionId,
    underlier: underlying,
    strategy_code: strategyCode,
    client_name: clientName,
    lifecycle: 'open',
    entry_ts: entryTs,
    created_by: params.createdBy ?? null,
  })

  if (positionError) {
    return { ok: false, error: positionError.message }
  }

  let seq = 1
  const legRows = normalizedRows.map((row) => ({
    position_id: positionId,
    leg_seq: seq++,
    side: row.side,
    option_type: row.optionType,
    expiry: row.expiry,
    strike: row.strike,
    qty: row.qty,
    price: row.price,
  }))

  const fillRows = normalizedRows.map((row, i) => ({
    position_id: positionId,
    leg_seq: legRows[i].leg_seq,
    ts: row.timestamp,
    qty: row.qty,
    price: row.price,
    open_close: row.openClose,
    side: row.side,
    trade_id: row.tradeId,
    order_id: row.orderId,
    fees: row.fee,
    notes: row.notes,
  }))

  const { error: legsError } = await client.from('legs').insert(legRows)
  if (legsError) {
    // Clean up the position row we just inserted
    await client.from('positions').delete().eq('position_id', positionId)
    return { ok: false, error: legsError.message }
  }

  if (fillRows.length) {
    const { error: fillsError } = await client.from('fills').insert(fillRows)
    if (fillsError) {
      await client.from('positions').delete().eq('position_id', positionId)
      return { ok: false, error: fillsError.message }
    }
  }

  return { ok: true, positionId, inserted: legRows.length }
}
