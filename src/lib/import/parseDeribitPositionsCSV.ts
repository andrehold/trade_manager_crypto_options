import Papa from 'papaparse'
import { type TxnRow, type Exchange, parseInstrumentByExchange } from '@/utils'

/**
 * Raw row shape from Deribit positions CSV export.
 * Only the fields we actually use are typed; the rest flows through rawCsv.
 */
interface DeribitPositionRow {
  instrument_name: string
  kind: string
  direction: string
  size: string
  average_price: string
  average_price_usd: string
  mark_price: string
  index_price: string
  delta: string
  gamma: string
  vega: string
  theta: string
  floating_profit_loss: string
  realized_profit_loss: string
  total_profit_loss: string
  [key: string]: string
}

export interface ParsedDeribitPositions {
  rows: TxnRow[]
  skipped: { row: DeribitPositionRow; reason: string }[]
}

/**
 * Parse a Deribit positions CSV (the snapshot export, NOT trades) into TxnRow[].
 *
 * Each row becomes a synthetic TxnRow with:
 * - A deterministic synthetic trade_id for dedup
 * - info note marking it as a reconciliation entry
 * - rawCsv containing the full original row for audit
 *
 * Filters out non-option rows (futures, etc.) and rows with zero size.
 */
export function parseDeribitPositionsCSV(csvText: string): ParsedDeribitPositions {
  const parsed = Papa.parse<DeribitPositionRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  const reconcileTs = new Date().toISOString()
  const rows: TxnRow[] = []
  const skipped: ParsedDeribitPositions['skipped'] = []

  for (const raw of parsed.data) {
    // Filter: only options
    if ((raw.kind ?? '').toLowerCase() !== 'option') {
      skipped.push({ row: raw, reason: 'not_option' })
      continue
    }

    const instrument = (raw.instrument_name ?? '').trim()
    if (!instrument) {
      skipped.push({ row: raw, reason: 'no_instrument' })
      continue
    }

    const size = Math.abs(parseFloat(raw.size))
    if (!size || isNaN(size)) {
      skipped.push({ row: raw, reason: 'zero_or_invalid_size' })
      continue
    }

    const direction = (raw.direction ?? '').toLowerCase()
    const side: 'buy' | 'sell' = direction === 'sell' ? 'sell' : 'buy'

    const avgPrice = parseFloat(raw.average_price)
    if (isNaN(avgPrice)) {
      skipped.push({ row: raw, reason: 'invalid_average_price' })
      continue
    }

    // Parse instrument to extract underlying/expiry/strike/optionType
    const parsedInstr = parseInstrumentByExchange('deribit' as Exchange, instrument)

    const syntheticTradeId = `reconcile-${instrument}-${reconcileTs}`

    const txnRow: TxnRow = {
      instrument,
      side,
      action: 'open',
      amount: size,
      price: avgPrice,
      timestamp: reconcileTs,
      trade_id: syntheticTradeId,
      exchange: 'deribit',
      info: 'Synthetic entry from Deribit positions CSV reconciliation',
      underlying: parsedInstr?.underlying,
      expiry: parsedInstr?.expiryISO,
      strike: parsedInstr?.strike,
      optionType: parsedInstr?.optionType,
      rawCsv: {
        ...raw,
        average_price_usd: raw.average_price_usd,
        mark_price: raw.mark_price,
        index_price: raw.index_price,
        delta: raw.delta,
        gamma: raw.gamma,
        vega: raw.vega,
        theta: raw.theta,
      },
    }

    rows.push(txnRow)
  }

  return { rows, skipped }
}
