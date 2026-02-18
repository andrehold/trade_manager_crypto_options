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
 * Heuristic to suggest structure type
 */
export function suggestStructureType(items: LegItem[]): string {
  if (items.length === 0) return 'Custom'

  const { legMap } = aggregateStructureLegs(items)
  const callCount = Array.from(legMap.values()).filter((e) => e.key.optionType === 'C').length
  const putCount = Array.from(legMap.values()).filter((e) => e.key.optionType === 'P').length
  const expiries = new Set(Array.from(legMap.values()).map((e) => e.key.expiry))

  // 4 legs, both calls and puts, single expiry -> Iron Condor
  if (items.length === 4 && callCount > 0 && putCount > 0 && expiries.size === 1) {
    return 'IC'
  }

  // Multiple expiries -> likely diagonal/calendar spread
  if (expiries.size > 1) {
    return 'DS'
  }

  return 'Custom'
}
