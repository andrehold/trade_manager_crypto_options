import React from 'react'
import { Download, Trash2, X } from 'lucide-react'
import Overlay from './Overlay'
import {
  formatInstrumentLabel,
  getLegMarkRef,
  legNetQty,
  positionGreeks,
  type Position,
} from '../utils'

type MarkInfo = { price: number | null; multiplier: number | null; greeks?: any }
type MarkMap = Record<string, MarkInfo>

type TradeJsonExportOverlayProps = {
  open: boolean
  onClose: () => void
  position: Position
  marks?: MarkMap
}

type TradeLegRow = {
  id: string
  instrument: string
  qty: number
  side: 'BUY' | 'SELL'
}

const SIDE_OPTIONS: Array<TradeLegRow['side']> = ['BUY', 'SELL']

function getLegInstrument(position: Position, leg: Position['legs'][number]) {
  const ref = getLegMarkRef(position, leg)
  if (ref?.symbol) return ref.symbol
  const expiryISO = leg.expiry ?? position.expiryISO
  return formatInstrumentLabel(position.underlying, expiryISO, leg.strike, leg.optionType)
}

function normalizeQty(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

function buildDefaultLegRows(position: Position): TradeLegRow[] {
  return [...position.legs]
    .sort((a, b) => {
      const expiryA = a.expiry ?? position.expiryISO ?? ''
      const expiryB = b.expiry ?? position.expiryISO ?? ''
      if (expiryA !== expiryB) return expiryA.localeCompare(expiryB)
      return (a.strike ?? 0) - (b.strike ?? 0)
    })
    .map((leg) => {
      const qtyNet = legNetQty(leg)
      const side = qtyNet >= 0 ? 'BUY' : 'SELL'
      return {
        id: leg.key,
        instrument: getLegInstrument(position, leg),
        qty: Math.abs(qtyNet),
        side,
      }
    })
}

function computeNetMark(position: Position, marks?: MarkMap) {
  if (!marks) return null
  let sum = 0
  let hasAny = false
  for (const leg of position.legs) {
    const ref = getLegMarkRef(position, leg)
    if (!ref) continue
    const info = marks[ref.key]
    if (info?.price == null) continue
    const multiplier = ref.exchange === 'coincall' ? info.multiplier : ref.defaultMultiplier
    const m = Number.isFinite(multiplier as number) ? (multiplier as number) : 1
    sum += info.price * legNetQty(leg) * m
    hasAny = true
  }
  return hasAny ? sum : null
}

function fallbackGreeks(position: Position) {
  const g = position.greeks ?? {}
  const toNumber = (value?: number | null) => (Number.isFinite(value as number) ? (value as number) : 0)
  return {
    delta: toNumber(g.delta),
    gamma: toNumber(g.gamma),
    theta: toNumber(g.theta),
    vega: toNumber(g.vega),
    rho: toNumber(g.rho),
  }
}

export function TradeJsonExportOverlay({ open, onClose, position, marks }: TradeJsonExportOverlayProps) {
  const [rows, setRows] = React.useState<TradeLegRow[]>(() => buildDefaultLegRows(position))

  React.useEffect(() => {
    if (!open) return
    setRows(buildDefaultLegRows(position))
  }, [open, position])

  const previewGreeks = React.useMemo(
    () => (marks ? positionGreeks(position, marks) : fallbackGreeks(position)),
    [marks, position],
  )

  const tradePayload = React.useMemo(() => {
    const netMark = computeNetMark(position, marks)
    return {
      created_at_utc: new Date().toISOString(),
      legs: rows.map((row) => ({
        instrument_name: row.instrument.trim(),
        qty: normalizeQty(row.qty),
        side: row.side,
      })),
      preview: {
        delta: previewGreeks.delta,
        gamma: previewGreeks.gamma,
        net_mark_btc: netMark,
        net_taker_btc: null,
        ref_px: null,
        rho: previewGreeks.rho,
        theta: previewGreeks.theta,
        vega: previewGreeks.vega,
      },
      structure: position.strategy || position.structureId || position.underlying || 'Custom',
      version: 1,
    }
  }, [marks, position, previewGreeks, rows])

  const hasRows = rows.length > 0
  const hasValidRows = hasRows && rows.every((row) => row.instrument.trim().length > 0 && row.qty > 0)

  const handleDownload = () => {
    const json = JSON.stringify(tradePayload, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${position.underlying || 'trade'}-structure.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <Overlay open={open} onClose={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700/60 max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700/60 p-4">
          <div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Export trade JSON</div>
            <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              {position.underlying} · {position.expiryISO}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close trade export overlay"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 overflow-auto">
          <div className="text-sm text-slate-600 dark:text-slate-300 mb-3">
            Review and edit legs before exporting the trade payload.
          </div>
          {rows.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">No legs available to export.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700/60">
                  <tr>
                    <th className="p-2 text-left min-w-[220px]">Instrument</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-left">Side</th>
                    <th className="p-2 text-right">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-200 dark:border-slate-700/60 last:border-0">
                      <td className="p-2">
                        <input
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-200"
                          value={row.instrument}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id ? { ...item, instrument: e.target.value } : item,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-right font-mono text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-200"
                          value={row.qty}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id ? { ...item, qty: normalizeQty(Number(e.target.value)) } : item,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="p-2">
                        <select
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-200"
                          value={row.side}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id ? { ...item, side: e.target.value as TradeLegRow['side'] } : item,
                              ),
                            )
                          }
                        >
                          {SIDE_OPTIONS.map((side) => (
                            <option key={side} value={side}>
                              {side}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60"
                          onClick={() => setRows((prev) => prev.filter((item) => item.id !== row.id))}
                          title="Remove leg"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="border-t border-slate-200 dark:border-slate-700/60 p-4 flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Download includes editable legs, current greeks, and metadata.
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!hasValidRows}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 shadow disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Download trade JSON
          </button>
        </div>
      </div>
    </Overlay>
  )
}
