import type { SupabaseClient } from '@supabase/supabase-js'
import type { TxnRow, Exchange } from '@/utils'
import type { SupabaseClientScope } from './clientScope'
import { cleanupUnprocessedImports } from './cleanupUnprocessedImports'
import { type NormalizedTrade, normalizeTradeRow } from './normalizeTradeRow'

export type AppendTradesToStructureParams = {
  structureId: string;
  rows: TxnRow[];
  clientScope?: SupabaseClientScope;
}

export type AppendTradesToStructureResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string }

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

  const rawExchange = rows[0]?.exchange
  const VALID_EXCHANGES = ['deribit', 'coincall', 'cme'] as const
  if (!rawExchange || !VALID_EXCHANGES.includes(rawExchange as Exchange)) {
    return { ok: false, error: `Invalid or missing exchange: "${rawExchange}". Expected one of: ${VALID_EXCHANGES.join(', ')}` }
  }
  const exchange = rawExchange as Exchange

  const normalizedRows: NormalizedTrade[] = []
  for (const row of rows) {
    const normalized = normalizeTradeRow(row, exchange)
    if (!normalized.ok) {
      return { ok: false, error: normalized.error }
    }
    normalizedRows.push(normalized.value)
  }

  const clientName = params.clientScope?.clientName?.trim() || null
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
      // Clean up the legs we just inserted to avoid orphan rows
      const { error: cleanupErr } = await client
        .from('legs')
        .delete()
        .eq('position_id', structureId)
        .in('leg_seq', legRows.map((r) => r.leg_seq))
      if (cleanupErr) {
        console.error('[appendTradesToStructure] Orphan legs cleanup failed after fills insert error:', structureId, cleanupErr.message)
      }
      return { ok: false, error: fillsError.message }
    }
  }

  // Remove matching rows from unprocessed_imports so they no longer appear in
  // the backlog after being promoted to an existing structure.
  await cleanupUnprocessedImports(client, {
    rows,
    tradeIds: normalizedRows.map((r) => r.tradeId),
    orderIds: normalizedRows.map((r) => r.orderId),
    clientName,
    restrictByClient,
    logPrefix: 'appendTradesToStructure',
  })

  return { ok: true, inserted: legRows.length }
}
