import type { SupabaseClient } from '@supabase/supabase-js'
import type { TxnRow } from '@/utils'

export type FilterDuplicateRowsOptions = {
  clientName?: string | null
  isAdmin?: boolean
  allowAllocations?: boolean
}

export type FilterDuplicateRowsResult = {
  filtered: TxnRow[]
  duplicates: TxnRow[]
  duplicatesInStructures: TxnRow[]
  duplicatesInBacklog: TxnRow[]
  duplicateTradeIds: string[]
  duplicateOrderIds: string[]
}

const CHUNK_SIZE = 99

/** Normalize a raw timestamp the same way createStructure does, so we can match against fills.ts */
function normalizeTimestamp(raw: string | undefined | null): string {
  if (!raw) return ''
  const d = new Date(raw.trim())
  return Number.isNaN(d.getTime()) ? raw.trim() : d.toISOString()
}

function normalizeSide(raw: string | undefined | null): string {
  if (!raw) return ''
  const s = raw.trim().toLowerCase()
  if (s.startsWith('buy') || s === 'b') return 'buy'
  if (s.startsWith('sell') || s === 's') return 'sell'
  return s
}

/**
 * Build a natural-key fingerprint from the fields stored in unprocessed_imports.
 * Used to detect duplicates when trade_id / order_id are not available.
 */
function naturalKey(
  instrument: string | null | undefined,
  timestamp: string | null | undefined,
  side: string | null | undefined,
  amount: number | string | null | undefined,
  price: number | string | null | undefined,
): string {
  const n = (v: unknown) => (v == null ? '' : String(v).trim())
  return `${n(instrument)}|${n(timestamp)}|${n(side)}|${n(amount)}|${n(price)}`
}

/**
 * Build a fingerprint for matching against fills (which stores normalized values).
 * Uses ISO timestamp, abs(qty), normalized side.
 */
function fillsKey(
  instrument: string | null | undefined,
  ts: string | null | undefined,
  side: string | null | undefined,
  qty: number | string | null | undefined,
  price: number | string | null | undefined,
): string {
  const n = (v: unknown) => (v == null ? '' : String(v).trim())
  const numQty = Math.abs(Number(qty) || 0)
  return `${n(instrument)}|${normalizeTimestamp(ts)}|${normalizeSide(side)}|${numQty}|${Number(price) || 0}`
}

/**
 * Queries fills + unprocessed_imports to remove rows whose trade_id / order_id
 * already exist in the database. For rows without IDs, falls back to matching
 * on natural key fields (instrument, timestamp, side, amount, price).
 *
 * Used before populating the AssignLegs backlog to prevent the same CSV from
 * re-importing identical legs on every import.
 */
export async function filterDuplicateRows(
  supabase: SupabaseClient,
  rows: TxnRow[],
  options: FilterDuplicateRowsOptions = {},
): Promise<FilterDuplicateRowsResult> {
  const noOp = (): FilterDuplicateRowsResult => ({
    filtered: rows,
    duplicates: [],
    duplicatesInStructures: [],
    duplicatesInBacklog: [],
    duplicateTradeIds: [],
    duplicateOrderIds: [],
  })

  if (rows.length === 0) return noOp()

  const clientFilter = options.clientName?.trim()
  const restrictByClient = Boolean(clientFilter) && !options.isAdmin

  const uniqueTradeIds = Array.from(
    new Set(rows.map((r) => r.trade_id?.trim()).filter((id): id is string => Boolean(id))),
  )
  const uniqueOrderIds = Array.from(
    new Set(rows.map((r) => r.order_id?.trim()).filter((id): id is string => Boolean(id))),
  )

  const duplicateTradeIds = new Set<string>()
  const duplicateOrderIds = new Set<string>()

  // Track which source each duplicate ID was found in
  const fillsTradeIds = new Set<string>()
  const backlogTradeIds = new Set<string>()
  const fillsOrderIds = new Set<string>()
  const backlogOrderIds = new Set<string>()

  // ── trade_id chunks ──────────────────────────────────────────────────────
  for (let start = 0; start < uniqueTradeIds.length; start += CHUNK_SIZE) {
    const chunk = uniqueTradeIds.slice(start, start + CHUNK_SIZE)

    // fills table
    let fillsQuery = supabase
      .from('fills')
      .select(restrictByClient ? 'trade_id, positions!inner(client_name)' : 'trade_id')
      .in('trade_id', chunk)
    if (restrictByClient && clientFilter) {
      fillsQuery = fillsQuery.eq('positions.client_name', clientFilter)
    }
    const { data: fills, error: fillsErr } = await fillsQuery
    if (fillsErr) {
      console.warn('filterDuplicateRows: failed to check fills for trade_ids', fillsErr)
      return noOp()
    }
    for (const entry of (fills as { trade_id?: string | null }[] | null) ?? []) {
      const id = typeof entry.trade_id === 'string' ? entry.trade_id.trim() : ''
      if (id) { duplicateTradeIds.add(id); fillsTradeIds.add(id) }
    }

    // unprocessed_imports table
    const { data: unproc, error: unprocErr } = await supabase
      .from('unprocessed_imports')
      .select('trade_id, client_name')
      .in('trade_id', chunk)
      .match(restrictByClient && clientFilter ? { client_name: clientFilter } : {})
    if (unprocErr) {
      console.warn('filterDuplicateRows: failed to check unprocessed_imports for trade_ids', unprocErr)
    }
    for (const entry of unproc ?? []) {
      const id = typeof entry.trade_id === 'string' ? entry.trade_id.trim() : ''
      const sameClient = !restrictByClient || !clientFilter || entry.client_name === clientFilter
      if (id && sameClient) { duplicateTradeIds.add(id); backlogTradeIds.add(id) }
    }
  }

  // ── order_id chunks ──────────────────────────────────────────────────────
  for (let start = 0; start < uniqueOrderIds.length; start += CHUNK_SIZE) {
    const chunk = uniqueOrderIds.slice(start, start + CHUNK_SIZE)

    let fillsQuery = supabase
      .from('fills')
      .select(restrictByClient ? 'order_id, positions!inner(client_name)' : 'order_id')
      .in('order_id', chunk)
    if (restrictByClient && clientFilter) {
      fillsQuery = fillsQuery.eq('positions.client_name', clientFilter)
    }
    const { data: fills, error: fillsErr } = await fillsQuery
    if (fillsErr) {
      console.warn('filterDuplicateRows: failed to check fills for order_ids', fillsErr)
      return noOp()
    }
    for (const entry of (fills as { order_id?: string | null }[] | null) ?? []) {
      const id = typeof entry.order_id === 'string' ? entry.order_id.trim() : ''
      if (id) { duplicateOrderIds.add(id); fillsOrderIds.add(id) }
    }

    const { data: unproc, error: unprocErr } = await supabase
      .from('unprocessed_imports')
      .select('order_id, client_name')
      .in('order_id', chunk)
      .match(restrictByClient && clientFilter ? { client_name: clientFilter } : {})
    if (unprocErr) {
      console.warn('filterDuplicateRows: failed to check unprocessed_imports for order_ids', unprocErr)
    }
    for (const entry of unproc ?? []) {
      const id = typeof entry.order_id === 'string' ? entry.order_id.trim() : ''
      const sameClient = !restrictByClient || !clientFilter || entry.client_name === clientFilter
      if (id && sameClient) { duplicateOrderIds.add(id); backlogOrderIds.add(id) }
    }
  }

  // ── natural-key fallback for rows without trade_id / order_id ────────────
  // Rows that have no IDs can't be caught by the checks above. We match them
  // against unprocessed_imports (by instrument/timestamp/side/amount/price) and
  // against fills (by normalised ts/side/qty/price).
  const idLessIndices: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].trade_id?.trim() && !rows[i].order_id?.trim()) {
      idLessIndices.push(i)
    }
  }

  const naturalKeyDups = new Set<number>() // indices into `rows`
  const naturalKeyFillsDups = new Set<number>()
  const naturalKeyBacklogDups = new Set<number>()

  if (idLessIndices.length > 0) {
    const idLessRows = idLessIndices.map((i) => rows[i])

    // — check unprocessed_imports by natural key —
    const instruments = Array.from(
      new Set(idLessRows.map((r) => r.instrument?.trim()).filter((s): s is string => Boolean(s))),
    )

    const existingNaturalKeys = new Set<string>()
    for (let start = 0; start < instruments.length; start += CHUNK_SIZE) {
      const chunk = instruments.slice(start, start + CHUNK_SIZE)
      let q = supabase
        .from('unprocessed_imports')
        .select('instrument, timestamp, side, amount, price')
        .in('instrument', chunk)
      if (restrictByClient && clientFilter) q = q.eq('client_name', clientFilter)
      const { data, error } = await q
      if (error) {
        console.warn('filterDuplicateRows: failed to check unprocessed_imports by natural key', error)
      }
      for (const entry of data ?? []) {
        existingNaturalKeys.add(naturalKey(entry.instrument, entry.timestamp, entry.side, entry.amount, entry.price))
      }
    }

    // — check fills by normalised key (ts, side, qty, price) —
    const uniqueNormTimestamps = Array.from(
      new Set(idLessRows.map((r) => normalizeTimestamp(r.timestamp)).filter(Boolean)),
    )

    const existingFillsKeys = new Set<string>()
    for (let start = 0; start < uniqueNormTimestamps.length; start += CHUNK_SIZE) {
      const chunk = uniqueNormTimestamps.slice(start, start + CHUNK_SIZE)
      let q = supabase
        .from('fills')
        .select(restrictByClient ? 'instrument, ts, side, qty, price, positions!inner(client_name)' : 'instrument, ts, side, qty, price')
        .in('ts', chunk)
      if (restrictByClient && clientFilter) q = q.eq('positions.client_name', clientFilter)
      const { data, error } = await q
      if (error) {
        console.warn('filterDuplicateRows: failed to check fills by natural key', error)
      }
      for (const entry of (data ?? []) as { instrument?: string; ts?: string; side?: string; qty?: number | string; price?: number | string }[]) {
        existingFillsKeys.add(fillsKey(entry.instrument, entry.ts, entry.side, entry.qty, entry.price))
      }
    }

    // Mark ID-less rows that match either set
    for (const idx of idLessIndices) {
      const row = rows[idx]
      const nk = naturalKey(row.instrument, row.timestamp, row.side, row.amount, row.price)
      if (existingNaturalKeys.has(nk)) {
        naturalKeyDups.add(idx)
        naturalKeyBacklogDups.add(idx)
        continue
      }
      const fk = fillsKey(row.instrument, row.timestamp, row.side, row.amount, row.price)
      if (existingFillsKeys.has(fk)) {
        naturalKeyDups.add(idx)
        naturalKeyFillsDups.add(idx)
      }
    }
  }

  // ── nothing found at all → pass everything through ─────────────────────
  if (!duplicateTradeIds.size && !duplicateOrderIds.size && !naturalKeyDups.size) return noOp()

  if (options.allowAllocations) {
    return {
      filtered: rows,
      duplicates: [],
      duplicatesInStructures: [],
      duplicatesInBacklog: [],
      duplicateTradeIds: Array.from(duplicateTradeIds),
      duplicateOrderIds: Array.from(duplicateOrderIds),
    }
  }

  // ── split into filtered / duplicates ───────────────────────────────────
  const filtered: TxnRow[] = []
  const duplicates: TxnRow[] = []
  const duplicatesInStructures: TxnRow[] = []
  const duplicatesInBacklog: TxnRow[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const tid = row.trade_id?.trim()
    const oid = row.order_id?.trim()
    const isDupById = (Boolean(tid) && duplicateTradeIds.has(tid!)) || (Boolean(oid) && duplicateOrderIds.has(oid!))
    const isDupByKey = naturalKeyDups.has(i)

    if (isDupById || isDupByKey) {
      duplicates.push(row)

      // Determine source: fills (structures) takes priority over backlog
      const inFillsById = (Boolean(tid) && fillsTradeIds.has(tid!)) || (Boolean(oid) && fillsOrderIds.has(oid!))
      const inFillsByKey = naturalKeyFillsDups.has(i)
      if (inFillsById || inFillsByKey) {
        duplicatesInStructures.push(row)
      } else {
        duplicatesInBacklog.push(row)
      }
    } else {
      filtered.push(row)
    }
  }

  return {
    filtered,
    duplicates,
    duplicatesInStructures,
    duplicatesInBacklog,
    duplicateTradeIds: Array.from(duplicateTradeIds),
    duplicateOrderIds: Array.from(duplicateOrderIds),
  }
}
