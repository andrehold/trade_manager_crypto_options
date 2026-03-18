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

type GreeksData = { delta?: number | null; gamma?: number | null; theta?: number | null; vega?: number | null; rho?: number | null }
type MarkInfo = { price: number | null; multiplier: number | null; greeks?: GreeksData }
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
      <div className="bg-surface-section rounded-2xl shadow-xl border border-default dark:border-strong/60 max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-default dark:border-strong/60 p-4">
          <div>
            <div className="type-subhead text-muted dark:text-faint">Export trade JSON</div>
            <div className="type-title-m font-semibold text-strong dark:text-heading">
              {position.underlying} · {position.expiryISO}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-muted dark:text-body hover:bg-surface-hover dark:hover:bg-surface-card"
            aria-label="Close trade export overlay"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 overflow-auto">
          <div className="type-subhead text-subtle dark:text-body mb-3">
            Review and edit legs before exporting the trade payload.
          </div>
          {rows.length === 0 ? (
            <div className="type-subhead text-muted dark:text-faint">No legs available to export.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full type-subhead">
                <thead className="text-muted dark:text-faint border-b border-default dark:border-strong/60">
                  <tr>
                    <th className="p-2 text-left min-w-[220px]">Instrument</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-left">Side</th>
                    <th className="p-2 text-right">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-default dark:border-strong/60 last:border-0">
                      <td className="p-2">
                        <input
                          className="w-full rounded-lg border border-default dark:border-strong bg-surface-card px-2 py-1 type-subhead text-heading dark:text-heading focus:outline-none focus:ring-2 focus:ring-border-accent dark:focus:ring-border-accent"
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
                          className="w-24 rounded-lg border border-default dark:border-strong bg-surface-card px-2 py-1 text-right font-mono type-subhead text-heading dark:text-heading focus:outline-none focus:ring-2 focus:ring-border-accent dark:focus:ring-border-accent"
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
                          className="rounded-lg border border-default dark:border-strong bg-surface-card px-2 py-1 type-subhead text-heading dark:text-heading focus:outline-none focus:ring-2 focus:ring-border-accent dark:focus:ring-border-accent"
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
                          className="inline-flex items-center justify-center rounded-md border border-default dark:border-strong bg-surface-card p-2 text-muted dark:text-body hover:bg-surface-hover dark:hover:bg-surface-hover/60"
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
        <div className="border-t border-default dark:border-strong/60 p-4 flex items-center justify-between gap-2">
          <div className="type-caption text-muted dark:text-faint">
            Download includes editable legs, current greeks, and metadata.
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!hasValidRows}
            className="inline-flex items-center gap-2 rounded-lg bg-surface-primary-btn dark:bg-surface-primary-btn px-4 py-2 type-subhead font-medium text-on-primary-btn dark:text-on-primary-btn shadow disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Download trade JSON
          </button>
        </div>
      </div>
    </Overlay>
  )
}
