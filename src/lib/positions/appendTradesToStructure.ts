import type { SupabaseClient } from '@supabase/supabase-js'
import type { TxnRow, Exchange } from '@/utils'
import { extractIdentifier } from './identifiers'
import { parseInstrumentByExchange } from '@/utils'
import type { SupabaseClientScope } from './clientScope'

export type AppendTradesToStructureParams = {
  structureId: string;
  rows: TxnRow[];
  clientScope?: SupabaseClientScope;
}

export type AppendTradesToStructureResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string }

type NormalizedTrade = {
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

type NormalizeResult = { ok: true; value: NormalizedTrade } | { ok: false; error: string }

function normalizeSide(raw: string | undefined): 'buy' | 'sell' | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase()
  if (normalized.startsWith('buy') || normalized === 'b') return 'buy'
  if (normalized.startsWith('sell') || normalized === 's') return 'sell'
  return null
}

function normalizeOptionType(raw: string | undefined): 'call' | 'put' | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'c' || normalized === 'call') return 'call'
  if (normalized === 'p' || normalized === 'put') return 'put'
  return null
}

function normalizeDateOnly(raw: string | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const dateOnlyMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
  if (dateOnlyMatch) return dateOnlyMatch[1]
  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }
  return null
}

function normalizeTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString()
  const trimmed = raw.trim()
  if (!trimmed) return new Date().toISOString()
  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }
  return trimmed
}

function normalizeOpenClose(raw: string | undefined): 'open' | 'close' | null {
  const normalized = sanitizeText(raw)?.toLowerCase()
  if (normalized === 'open' || normalized === 'close') return normalized
  return null
}

function toNumeric(value: unknown): number | null {
  if (value == null) return null
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function sanitizeText(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed.length ? trimmed : null
}

function describeRow(row: TxnRow): string {
  const tradeId = extractIdentifier(row, 'trade')
  if (tradeId) return `trade ${tradeId}`
  const orderId = extractIdentifier(row, 'order')
  if (orderId) return `order ${orderId}`
  return row.instrument || 'trade row'
}

function normalizeTradeRow(row: TxnRow): NormalizeResult {
  const qty = toNumeric(row.amount)
  if (qty == null || qty === 0) {
    return { ok: false, error: `Missing quantity for ${describeRow(row)}.` }
  }

  const price = toNumeric(row.price)
  if (price == null) {
    return { ok: false, error: `Missing price for ${describeRow(row)}.` }
  }

  const side = normalizeSide(row.side as string)
  if (!side) {
    return { ok: false, error: `Missing side (buy/sell) for ${describeRow(row)}.` }
  }

  const exchange = (row.exchange as Exchange) ?? 'deribit'
  const parsed = parseInstrumentByExchange(exchange, row.instrument)

  const expiry = normalizeDateOnly(row.expiry) ?? normalizeDateOnly(parsed?.expiryISO)
  if (!expiry) {
    return { ok: false, error: `Missing expiry for ${describeRow(row)}.` }
  }

  const strike = toNumeric(row.strike ?? parsed?.strike)
  if (strike == null) {
    return { ok: false, error: `Missing strike for ${describeRow(row)}.` }
  }

  const optionType =
    normalizeOptionType(row.optionType as string | undefined) ||
    normalizeOptionType(parsed?.optionType as string | undefined)
  if (!optionType) {
    return { ok: false, error: `Missing option type for ${describeRow(row)}.` }
  }

  const timestamp = normalizeTimestamp(row.timestamp)
  const openClose = normalizeOpenClose(row.action as string | undefined)
  const tradeId = extractIdentifier(row, 'trade')
  const orderId = extractIdentifier(row, 'order')
  const fee = toNumeric(row.fee)
  const notes = sanitizeText(row.info)

  return {
    ok: true,
    value: {
      side,
      optionType,
      expiry,
      strike,
      qty: Math.abs(qty),
      price,
      timestamp,
      openClose,
      tradeId,
      orderId,
      fee: fee ?? null,
      notes,
    },
  }
}

export async function appendTradesToStructure(
  client: SupabaseClient,
  params: AppendTradesToStructureParams,
): Promise<AppendTradesToStructureResult> {
  const structureId = params.structureId?.trim()
  if (!structureId) {
    return { ok: false, error: 'Missing structure identifier.' }
  }

  const rows = params.rows ?? []
  if (rows.length === 0) {
    return { ok: true, inserted: 0 }
  }

  const normalizedRows: NormalizedTrade[] = []
  for (const row of rows) {
    const normalized = normalizeTradeRow(row)
    if (!normalized.ok) {
      return { ok: false, error: normalized.error }
    }
    normalizedRows.push(normalized.value)
  }

  const clientName = params.clientScope?.clientName?.trim()
  const restrictByClient = Boolean(clientName) && !params.clientScope?.isAdmin

  let positionQuery = client
    .from('positions')
    .select('position_id')
    .eq('position_id', structureId)

  if (restrictByClient && clientName) {
    positionQuery = positionQuery.eq('client_name', clientName)
  }

  const { data: positionRow, error: positionError } = await positionQuery.limit(1).maybeSingle()
  if (positionError) {
    return { ok: false, error: positionError.message }
  }
  if (!positionRow) {
    return { ok: false, error: `Structure ${structureId} does not exist or is not accessible.` }
  }

  const { data: maxLeg, error: seqError } = await client
    .from('legs')
    .select('leg_seq')
    .eq('position_id', structureId)
    .order('leg_seq', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (seqError) {
    return { ok: false, error: seqError.message }
  }

  const currentSeq = maxLeg?.leg_seq != null ? Number(maxLeg.leg_seq) : 0
  let nextSeq = Number.isFinite(currentSeq) ? currentSeq + 1 : 1

  const legRows = normalizedRows.map((row) => ({
    position_id: structureId,
    leg_seq: nextSeq++,
    side: row.side,
    option_type: row.optionType,
    expiry: row.expiry,
    strike: row.strike,
    qty: row.qty,
    price: row.price,
  }))

  const fillRows = normalizedRows.map((row, index) => ({
    position_id: structureId,
    leg_seq: legRows[index].leg_seq,
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
    return { ok: false, error: legsError.message }
  }

  if (fillRows.length) {
    const { error: fillsError } = await client.from('fills').insert(fillRows)
    if (fillsError) {
      return { ok: false, error: fillsError.message }
    }
  }

  return { ok: true, inserted: legRows.length }
}
