import type { TxnRow, Exchange } from '@/utils'
import { parseInstrumentByExchange } from '@/utils'
import { extractIdentifier } from './identifiers'

export type NormalizedTrade = {
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

export type NormalizeResult = { ok: true; value: NormalizedTrade } | { ok: false; error: string }

export function normalizeSide(raw: string | undefined): 'buy' | 'sell' | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase()
  if (normalized.startsWith('buy') || normalized === 'b') return 'buy'
  if (normalized.startsWith('sell') || normalized === 's') return 'sell'
  return null
}

export function normalizeOptionType(raw: string | undefined): 'call' | 'put' | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'c' || normalized === 'call') return 'call'
  if (normalized === 'p' || normalized === 'put') return 'put'
  return null
}

export function normalizeDateOnly(raw: string | undefined): string | null {
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

export function normalizeTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString()
  const trimmed = raw.trim()
  if (!trimmed) return new Date().toISOString()
  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }
  return trimmed
}

export function normalizeOpenClose(raw: string | undefined): 'open' | 'close' | null {
  const normalized = sanitizeText(raw)?.toLowerCase()
  if (normalized === 'open' || normalized === 'close') return normalized
  return null
}

export function toNumeric(value: unknown): number | null {
  if (value == null) return null
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

export function sanitizeText(value: unknown): string | null {
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

export function normalizeTradeRow(row: TxnRow, exchange: Exchange): NormalizeResult {
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
