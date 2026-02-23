import { TxnRow, Exchange, parseInstrumentByExchange } from '../utils'

/**
 * DnD data model types
 */
export type LegItem = {
  id: string
  row: TxnRow
  included: boolean
}

export type BoardState = {
  itemsById: Record<string, LegItem>
  containers: Record<string, string[]> // containerId -> itemIds
  structureOrder: string[]
  structureMeta: Record<string, { type: string }>
}

/** Common option structure types with short codes and full names */
export const STRUCTURE_TYPES = [
  { code: 'IC', label: 'Iron Condor' },
  { code: 'IB', label: 'Iron Butterfly' },
  { code: 'VS', label: 'Vertical Spread' },
  { code: 'CS', label: 'Calendar Spread' },
  { code: 'DS', label: 'Diagonal Spread' },
  { code: 'ST', label: 'Straddle' },
  { code: 'SG', label: 'Strangle' },
  { code: 'BF', label: 'Butterfly' },
  { code: 'RS', label: 'Ratio Spread' },
  { code: 'CC', label: 'Covered Call' },
  { code: 'PP', label: 'Protective Put' },
  { code: 'CU', label: 'Custom' },
] as const

export type StructureTypeCode = (typeof STRUCTURE_TYPES)[number]['code']

/**
 * Generate stable unique ID for a leg item
 * Prefer trade_id > order_id > fallback: instrument|timestamp|index
 */
export function generateLegId(row: TxnRow, index: number): string {
  if (row.trade_id && row.trade_id.trim()) {
    return `leg:${row.trade_id}`
  }
  if (row.order_id && row.order_id.trim()) {
    return `leg:${row.order_id}`
  }
  const ts = row.timestamp || 'NO_TS'
  return `leg:${row.instrument}|${ts}|${index}`
}

/**
 * Format a leg label: ±qty / Strike / DD-MM
 * Example: -1 / P60000 / 27-02
 */
export function formatLegLabel(row: TxnRow, exchange: Exchange = 'deribit'): string {
  const qty = Math.abs(row.amount ?? 0)
  const qtyStr = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  const sign = row.side === 'sell' ? '-' : '+'
  const qtyPart = `${sign}${qtyStr}`

  const parsed = parseInstrumentByExchange(exchange, row.instrument)
  if (!parsed) {
    // Fallback if parsing fails
    return `${qtyPart} / ${row.instrument}`
  }

  const { optionType, strike, expiryISO } = parsed
  const strikePart = `${optionType}${strike}`

  // Format expiry as DD-MM
  const expiryPart = expiryISO
    ? expiryISO.split('-').slice(1, 3).reverse().join('-')
    : 'unk'

  return `${qtyPart} / ${strikePart} / ${expiryPart}`
}

/**
 * Aggregate legs in a structure by (expiry, strike, optionType) and compute net premium
 * Returns both summary for header and leg list
 */
export function aggregateStructureLegs(items: LegItem[]) {
  interface LegKey {
    expiry: string
    strike: number
    optionType: string
  }

  const legMap = new Map<string, { key: LegKey; netQty: number; netPremium: number }>()
  let totalNetPremium = 0

  for (const item of items) {
    const row = item.row
    const parsed = parseInstrumentByExchange(row.exchange ?? 'deribit', row.instrument)
    if (!parsed) continue

    const { expiryISO, strike, optionType } = parsed
    const expiry = expiryISO
    if (!expiry) continue

    const legKey = `${expiry}|${strike}|${optionType}`
    const qty = row.amount ?? 0
    const price = row.price ?? 0
    const premium = price * Math.abs(qty) * (row.side === 'sell' ? 1 : -1)

    const existing = legMap.get(legKey)
    if (existing) {
      existing.netQty += qty
      existing.netPremium += premium
    } else {
      legMap.set(legKey, {
        key: { expiry, strike, optionType },
        netQty: qty,
        netPremium: premium,
      })
    }

    totalNetPremium += premium
  }

  return { legMap, totalNetPremium }
}

/**
 * Format structure header
 * Format: ±qty / Type / legs / DD-MM
 * Where ±qty is determined by netPremium: < 0 (debit) => -, > 0 (credit) => +
 */
export function formatStructureLabel(
  items: LegItem[],
  structureType: string = 'Custom',
): string {
  if (items.length === 0) {
    return 'Empty'
  }

  const { legMap, totalNetPremium } = aggregateStructureLegs(items)

  // Determine sign from net premium
  const sign = totalNetPremium < 0 ? '-' : '+'
  const absPremium = Math.abs(totalNetPremium)
  const premiumStr = absPremium % 1 === 0 ? String(Math.round(absPremium)) : absPremium.toFixed(2)
  const qtyPart = `${sign}${premiumStr}`

  // Collect unique expiries
  const expiries = new Set<string>()
  const legParts: string[] = []

  for (const entry of legMap.values()) {
    expiries.add(entry.key.expiry)
    const netQtyStr = entry.netQty % 1 === 0 ? String(entry.netQty) : entry.netQty.toFixed(2)
    const qtyPrefix = Math.abs(entry.netQty) !== 1 ? `${Math.abs(entry.netQty)}×` : ''
    const legStr = `${entry.netQty < 0 ? '-' : '+'}${qtyPrefix}${entry.key.optionType}${entry.key.strike}`
    legParts.push(legStr)
  }

  const expiryList = Array.from(expiries).sort().join(' -- ')

  return `${qtyPart} / ${structureType} / ${legParts.join(' ')} / ${expiryList}`
}

/**
 * Auto-group rows by normalized timestamp
 */
export function autoGroupByTime(rows: TxnRow[], normalizeSecond: (ts?: string) => string): Record<string, number> {
  const map = new Map<string, number>()
  let structureCount = 1

  const result: Record<string, number> = {}
  rows.forEach((row, idx) => {
    const normalized = normalizeSecond(row.timestamp)
    if (!map.has(normalized)) {
      map.set(normalized, structureCount++)
    }
    result[generateLegId(row, idx)] = map.get(normalized)!
  })

  return result
}

/**
 * Heuristic to suggest structure type from a set of legs.
 *
 * Detection rules (evaluated in priority order):
 *
 * Multi-expiry (2 unique expiries, same type):
 *   DS  – 2 legs, same option type, different strikes AND different expiries
 *   CS  – 2 legs, same option type, same strike, different expiries
 *
 * Single-expiry, mixed C+P:
 *   ST  – 2 legs (1C + 1P), same strike
 *   SG  – 2 legs (1C + 1P), different strikes
 *   IB  – 4 legs, two middle strikes shared by C and P (short straddle + long strangle)
 *   IC  – 4 legs, 4 distinct strikes: sell put/call inner, buy put/call outer
 *
 * Single-expiry, same option type:
 *   VS  – 2 legs, 1 buy + 1 sell
 *   BF  – 4 legs, 3 equidistant strikes, 1-2-1 qty ratio
 *   RS  – unequal buy/sell quantities
 *
 * Fallback: CU (Custom)
 */
export function suggestStructureType(items: LegItem[]): string {
  if (items.length === 0) return 'CU'

  const { legMap } = aggregateStructureLegs(items)
  const legs = Array.from(legMap.values())

  const expiries = Array.from(new Set(legs.map((e) => e.key.expiry))).sort()
  const calls = legs.filter((e) => e.key.optionType === 'C')
  const puts  = legs.filter((e) => e.key.optionType === 'P')
  const allSameType = calls.length === 0 || puts.length === 0
  const mixedTypes  = calls.length > 0 && puts.length > 0

  // ── Multi-expiry (2 expiries only, same option type) ──────────────────────
  if (expiries.length === 2 && allSameType && legs.length === 2) {
    const [a, b] = legs
    if (a.key.strike === b.key.strike) return 'CS'   // same strike → Calendar
    return 'DS'                                        // different strike → Diagonal
  }

  // Any other multi-expiry → Diagonal fallback
  if (expiries.length > 1) return 'DS'

  // ── Single expiry ─────────────────────────────────────────────────────────
  const legCount = legs.length

  // --- Mixed C + P ---
  if (mixedTypes) {
    // Straddle / Strangle (2 legs: 1C + 1P)
    if (legCount === 2 && calls.length === 1 && puts.length === 1) {
      return calls[0].key.strike === puts[0].key.strike ? 'ST' : 'SG'
    }

    // Iron Butterfly / Iron Condor (4 legs: 2C + 2P)
    if (legCount === 4 && calls.length === 2 && puts.length === 2) {
      const callStrikes = calls.map((c) => c.key.strike).sort((a, b) => a - b)
      const putStrikes  = puts.map((p) => p.key.strike).sort((a, b) => a - b)
      // IB: the inner call strike equals the inner put strike (shared ATM body)
      const innerCall = callStrikes[0]  // lower call = short call body
      const innerPut  = putStrikes[1]   // higher put = short put body
      if (innerCall === innerPut) return 'IB'
      return 'IC'
    }
  }

  // --- Same option type ---
  if (allSameType) {
    // Vertical Spread: 2 legs, 1 buy + 1 sell
    if (legCount === 2) {
      const [a, b] = legs
      // netQty signs differ → one is long, one is short
      if ((a.netQty > 0 && b.netQty < 0) || (a.netQty < 0 && b.netQty > 0)) return 'VS'
    }

    // Butterfly: 4 aggregated legs map to 3 strikes with 1-2-1 net qty pattern
    if (legCount === 3) {
      const sorted = [...legs].sort((a, b) => a.key.strike - b.key.strike)
      const [lo, mid, hi] = sorted
      const loAbs  = Math.abs(lo.netQty)
      const midAbs = Math.abs(mid.netQty)
      const hiAbs  = Math.abs(hi.netQty)
      const spaceLo = mid.key.strike - lo.key.strike
      const spaceHi = hi.key.strike - mid.key.strike
      const equidistant = Math.abs(spaceLo - spaceHi) < 0.01
      const ratioOk = midAbs === loAbs * 2 && midAbs === hiAbs * 2
      // Outer legs same sign (long wings), middle opposite (short body) or vice-versa
      const wingsMatch = Math.sign(lo.netQty) === Math.sign(hi.netQty) && Math.sign(lo.netQty) !== Math.sign(mid.netQty)
      if (equidistant && ratioOk && wingsMatch) return 'BF'
    }

    // Ratio Spread: legs with unequal absolute quantities
    const qtys = legs.map((e) => Math.abs(e.netQty))
    const uniqueQtys = new Set(qtys)
    if (uniqueQtys.size > 1) return 'RS'
  }

  return 'CU'
}
