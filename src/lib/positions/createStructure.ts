import type { SupabaseClient } from '@supabase/supabase-js'
import type { TxnRow, Exchange } from '@/utils'
import type { OptionsStructure, Construction, ExecutionRoute } from '@/lib/import/types'
import type { SupabaseClientScope } from './clientScope'
import { cleanupUnprocessedImports } from './cleanupUnprocessedImports'
import { type NormalizedTrade, normalizeTradeRow } from './normalizeTradeRow'

export type CreateStructureParams = {
  rows: TxnRow[]
  structureType?: string
  exchange?: Exchange
  clientScope?: SupabaseClientScope
  createdBy?: string
  programId?: string
  strategyName?: string
  optionsStructure?: OptionsStructure
  construction?: Construction
  executionRoute?: ExecutionRoute
  notes?: string
}

export type CreateStructureResult =
  | { ok: true; positionId: string; inserted: number }
  | { ok: false; error: string }

export async function createStructure(
  client: SupabaseClient,
  params: CreateStructureParams,
): Promise<CreateStructureResult> {
  const rows = params.rows ?? []
  if (rows.length === 0) {
    return { ok: false, error: 'No rows provided.' }
  }

  const rawExchange = params.exchange ?? rows[0]?.exchange
  const VALID_EXCHANGES = ['deribit', 'coincall', 'cme'] as const
  if (!rawExchange || !VALID_EXCHANGES.includes(rawExchange as Exchange)) {
    return { ok: false, error: `Invalid or missing exchange: "${rawExchange}". Expected one of: ${VALID_EXCHANGES.join(', ')}` }
  }
  const exchange = rawExchange as Exchange

  const normalizedRows: NormalizedTrade[] = []
  for (const row of rows) {
    const result = normalizeTradeRow(row, exchange)
    if (!result.ok) return { ok: false, error: result.error }
    normalizedRows.push(result.value)
  }

  const positionId = crypto.randomUUID()
  const underlying = rows[0]?.underlying ?? ''
  const strategyCode = params.structureType ?? rows[0]?.structureType ?? null
  const clientName = params.clientScope?.clientName?.trim() || null
  const timestamps = normalizedRows.map((r) => r.timestamp).filter(Boolean).sort()
  const entryTs = timestamps[0] ?? new Date().toISOString()
  const isMultiLeg = normalizedRows.length > 1
  const optionsStructure = params.optionsStructure ?? (isMultiLeg ? 'strangle' : 'single_option')
  const construction = params.construction ?? (isMultiLeg ? 'balanced' : 'outright')
  const executionRoute = params.executionRoute ?? (isMultiLeg ? 'package' : 'single')

  // Compute net_fill from normalised leg prices: sum of (side-signed qty × price)
  const netFill = normalizedRows.reduce((acc, r) => {
    const sign = r.side === 'buy' ? 1 : -1
    return acc + sign * Math.abs(r.qty) * r.price
  }, 0)

  const { error: positionError } = await client.from('positions').insert({
    position_id: positionId,
    underlier: underlying,
    strategy_code: strategyCode,
    strategy_name: params.strategyName ?? null,
    program_id: params.programId ?? null,
    client_name: clientName,
    options_structure: optionsStructure,
    construction,
    risk_defined: isMultiLeg,
    execution_route: executionRoute,
    net_fill: netFill,
    provider: exchange,
    lifecycle: 'open',
    entry_ts: entryTs,
    archived: false,
    notes: params.notes ?? null,
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
    const { error: cleanupErr } = await client.from('positions').delete().eq('position_id', positionId)
    if (cleanupErr) {
      console.error('[createStructure] Orphan position cleanup failed after legs insert error:', positionId, cleanupErr.message)
    }
    return { ok: false, error: legsError.message }
  }

  if (fillRows.length) {
    const { error: fillsError } = await client.from('fills').insert(fillRows)
    if (fillsError) {
      const legSeqs = legRows.map((r) => r.leg_seq)
      const { error: legsCleanupErr } = await client
        .from('legs')
        .delete()
        .eq('position_id', positionId)
        .in('leg_seq', legSeqs)
      if (legsCleanupErr) {
        console.error('[createStructure] Orphan legs cleanup failed after fills insert error:', positionId, legsCleanupErr.message)
      }
      const { error: posCleanupErr } = await client.from('positions').delete().eq('position_id', positionId)
      if (posCleanupErr) {
        console.error('[createStructure] Orphan position cleanup failed after fills insert error:', positionId, posCleanupErr.message)
      }
      return { ok: false, error: fillsError.message }
    }
  }

  // Remove matching rows from unprocessed_imports so they no longer appear in
  // the backlog after being promoted to a structure.
  const restrictByClient = Boolean(clientName) && !params.clientScope?.isAdmin

  await cleanupUnprocessedImports(client, {
    rows,
    tradeIds: normalizedRows.map((r) => r.tradeId),
    orderIds: normalizedRows.map((r) => r.orderId),
    clientName,
    restrictByClient,
    logPrefix: 'createStructure',
  })

  return { ok: true, positionId, inserted: legRows.length }
}
