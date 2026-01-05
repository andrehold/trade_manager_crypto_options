import type { SupabaseClient } from '@supabase/supabase-js'
import type { TxnRow, Exchange } from '@/utils'
import { parseInstrumentByExchange } from '@/utils'
import { extractIdentifier } from './identifiers'
import type { SupabaseClientScope } from './clientScope'

type BackfillMatch = {
  expiry: string
  source: 'trade_id' | 'order_id'
}

type BackfillLegUpdate = {
  positionId: string
  legSeq: number
  expiry: string
}

export type BackfillLegExpiriesParams = {
  rows: TxnRow[]
  clientScope?: SupabaseClientScope
}

export type BackfillLegExpiriesResult =
  | { ok: true; updated: number; skipped: number }
  | { ok: false; error: string }

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return []
  const chunks: T[][] = []
  for (let idx = 0; idx < items.length; idx += size) {
    chunks.push(items.slice(idx, idx + size))
  }
  return chunks
}

function normalizeExpiry(row: TxnRow): string | null {
  if (row.expiry) return row.expiry
  const exchange = (row.exchange as Exchange) ?? 'deribit'
  const parsed = parseInstrumentByExchange(exchange, row.instrument)
  return parsed?.expiryISO ?? null
}

function buildIdentifierMaps(rows: TxnRow[]) {
  const tradeIdMap = new Map<string, BackfillMatch>()
  const orderIdMap = new Map<string, BackfillMatch>()

  for (const row of rows) {
    const expiry = normalizeExpiry(row)
    if (!expiry) continue

    const tradeId = extractIdentifier(row, 'trade')
    if (tradeId && !tradeIdMap.has(tradeId)) {
      tradeIdMap.set(tradeId, { expiry, source: 'trade_id' })
      continue
    }

    const orderId = extractIdentifier(row, 'order')
    if (orderId && !orderIdMap.has(orderId)) {
      orderIdMap.set(orderId, { expiry, source: 'order_id' })
    }
  }

  return { tradeIdMap, orderIdMap }
}

function collectLegUpdates(
  fills: Array<{ position_id: string; leg_seq: number; trade_id: string | null; order_id: string | null }>,
  tradeIdMap: Map<string, BackfillMatch>,
  orderIdMap: Map<string, BackfillMatch>,
): BackfillLegUpdate[] {
  const updates = new Map<string, BackfillLegUpdate>()

  for (const fill of fills) {
    const tradeId = fill.trade_id ?? undefined
    const orderId = fill.order_id ?? undefined
    const match =
      (tradeId ? tradeIdMap.get(tradeId) : undefined) ??
      (orderId ? orderIdMap.get(orderId) : undefined)

    if (!match) continue
    const legSeq = Number(fill.leg_seq)
    if (!Number.isFinite(legSeq) || legSeq <= 0) continue
    const key = `${fill.position_id}::${legSeq}`
    if (!updates.has(key)) {
      updates.set(key, {
        positionId: fill.position_id,
        legSeq,
        expiry: match.expiry,
      })
    }
  }

  return Array.from(updates.values())
}

export async function backfillLegExpiries(
  client: SupabaseClient,
  params: BackfillLegExpiriesParams,
): Promise<BackfillLegExpiriesResult> {
  const rows = params.rows ?? []
  if (rows.length === 0) {
    return { ok: true, updated: 0, skipped: 0 }
  }

  const { tradeIdMap, orderIdMap } = buildIdentifierMaps(rows)
  const tradeIds = Array.from(tradeIdMap.keys())
  const orderIds = Array.from(orderIdMap.keys())

  if (tradeIds.length === 0 && orderIds.length === 0) {
    return { ok: true, updated: 0, skipped: 0 }
  }

  const fills: Array<{
    position_id: string
    leg_seq: number
    trade_id: string | null
    order_id: string | null
  }> = []

  for (const tradeIdChunk of chunkArray(tradeIds, 100)) {
    let query = client
      .from('fills')
      .select('position_id, leg_seq, trade_id, order_id')
      .in('trade_id', tradeIdChunk)

    const { data, error } = await query
    if (error) {
      return { ok: false, error: error.message }
    }
    if (data) fills.push(...data)
  }

  for (const orderIdChunk of chunkArray(orderIds, 100)) {
    let query = client
      .from('fills')
      .select('position_id, leg_seq, trade_id, order_id')
      .in('order_id', orderIdChunk)

    const { data, error } = await query
    if (error) {
      return { ok: false, error: error.message }
    }
    if (data) fills.push(...data)
  }

  const updates = collectLegUpdates(fills, tradeIdMap, orderIdMap)
  let updated = 0
  let skipped = 0

  for (const update of updates) {
    const query = client
      .from('legs')
      .update({ expiry: update.expiry })
      .eq('position_id', update.positionId)
      .eq('leg_seq', update.legSeq)

    const { error } = await query
    if (error) {
      return { ok: false, error: error.message }
    }
    updated += 1
  }

  skipped = Math.max(0, updates.length - updated)
  return { ok: true, updated, skipped }
}
