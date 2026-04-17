import React from 'react'
import { RefreshCw } from 'lucide-react'
import { ExpiryDatePicker } from './ExpiryDatePicker'
import { Spinner } from './Spinner'
import type { ChainInstrument, DeribitTickerResult } from '../lib/venues/deribit'
import type { Position } from '../utils'

export interface OptionsChainProps {
  expiries: string[]
  selectedExpiry: string | null
  onSelectExpiry: (expiry: string) => void
  instruments: ChainInstrument[]
  tickers: Map<string, DeribitTickerResult>
  positions: Position[]
  loading: boolean
  lastUpdated: Date | null
  onRefresh: () => void
}

function fmtMark(v: number | undefined | null): string {
  if (v == null) return '—'
  return v.toFixed(4)
}

function fmtDelta(v: number | undefined | null): string {
  if (v == null) return '—'
  return v.toFixed(3)
}

function fmtStrike(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function timeSince(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

// Returns net qty of a position's legs at a given strike + side for the selected expiry
function positionNetQty(
  positions: Position[],
  expiry: string,
  strike: number,
  side: 'call' | 'put',
): number {
  let net = 0
  for (const pos of positions) {
    for (const leg of pos.legs) {
      const legExpiry = leg.expiry ?? pos.expiryISO
      if (legExpiry !== expiry) continue
      if (leg.strike !== strike) continue
      const legSide = leg.optionType === 'P' ? 'put' : 'call'
      if (legSide !== side) continue
      net += leg.qtyNet
    }
  }
  return net
}

function PositionBadge({ qty }: { qty: number }) {
  if (qty === 0) return null
  const isLong = qty > 0
  return (
    <span
      className={[
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums',
        isLong
          ? 'bg-emerald-500/15 text-emerald-400'
          : 'bg-rose-500/15 text-rose-400',
      ].join(' ')}
    >
      {isLong ? '+' : ''}{qty}
    </span>
  )
}

interface ChainRowProps {
  strike: number
  callInstrument: ChainInstrument | undefined
  putInstrument: ChainInstrument | undefined
  tickers: Map<string, DeribitTickerResult>
  positions: Position[]
  expiry: string
}

function ChainRow({ strike, callInstrument, putInstrument, tickers, positions, expiry }: ChainRowProps) {
  const callTicker = callInstrument ? tickers.get(callInstrument.instrument_name) : undefined
  const putTicker = putInstrument ? tickers.get(putInstrument.instrument_name) : undefined

  const callQty = positionNetQty(positions, expiry, strike, 'call')
  const putQty = positionNetQty(positions, expiry, strike, 'put')

  const hasCallPos = callQty !== 0
  const hasPutPos = putQty !== 0

  return (
    <tr
      className={[
        'border-b border-border-default transition-colors',
        hasCallPos || hasPutPos ? 'bg-surface-chip/30' : 'hover:bg-surface-hover/40',
      ].join(' ')}
    >
      {/* Call side */}
      <td className={['px-3 py-2 text-right tabular-nums type-caption', hasCallPos ? 'text-heading font-semibold' : 'text-body'].join(' ')}>
        {fmtMark(callTicker?.mark_price)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums type-caption text-subtle">
        {fmtDelta(callTicker?.greeks?.delta)}
      </td>
      <td className="px-3 py-2 text-right">
        <PositionBadge qty={callQty} />
      </td>

      {/* Strike */}
      <td className="px-4 py-2 text-center tabular-nums type-caption font-semibold text-heading bg-surface-section border-x border-border-default whitespace-nowrap">
        {fmtStrike(strike)}
      </td>

      {/* Put side */}
      <td className="px-3 py-2 text-left">
        <PositionBadge qty={putQty} />
      </td>
      <td className="px-3 py-2 text-left tabular-nums type-caption text-subtle">
        {fmtDelta(putTicker?.greeks?.delta)}
      </td>
      <td className={['px-3 py-2 text-left tabular-nums type-caption', hasPutPos ? 'text-heading font-semibold' : 'text-body'].join(' ')}>
        {fmtMark(putTicker?.mark_price)}
      </td>
    </tr>
  )
}

export function OptionsChain({
  expiries,
  selectedExpiry,
  onSelectExpiry,
  instruments,
  tickers,
  positions,
  loading,
  lastUpdated,
  onRefresh,
}: OptionsChainProps) {
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    if (!lastUpdated) return
    const id = setInterval(() => setTick((n) => n + 1), 15_000)
    return () => clearInterval(id)
  }, [lastUpdated])
  void tick

  const strikes = React.useMemo(() => {
    const set = new Set<number>()
    for (const inst of instruments) set.add(inst.strike)
    return Array.from(set).sort((a, b) => a - b)
  }, [instruments])

  const callsByStrike = React.useMemo(() => {
    const m = new Map<number, ChainInstrument>()
    for (const inst of instruments) {
      if (inst.option_type === 'call') m.set(inst.strike, inst)
    }
    return m
  }, [instruments])

  const putsByStrike = React.useMemo(() => {
    const m = new Map<number, ChainInstrument>()
    for (const inst of instruments) {
      if (inst.option_type === 'put') m.set(inst.strike, inst)
    }
    return m
  }, [instruments])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Expiry picker + update button */}
      <div className="flex items-center gap-3 border-b border-border-default pr-4">
        <div className="flex-1 min-w-0">
          <ExpiryDatePicker
            expiries={expiries}
            selected={selectedExpiry}
            onSelect={(e) => { if (e) onSelectExpiry(e) }}
          />
        </div>
        {selectedExpiry && (
          <div className="flex items-center gap-2 shrink-0">
            {lastUpdated && (
              <span className="type-micro text-muted tabular-nums">
                {timeSince(lastUpdated)}
              </span>
            )}
            <button
              onClick={onRefresh}
              disabled={loading}
              className={[
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg type-caption font-medium',
                'border border-border-default bg-surface-chip hover:bg-surface-hover',
                'text-body transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                'focus:outline-none focus:shadow-[var(--glow-accent-sm)]',
              ].join(' ')}
            >
              {loading
                ? <Spinner className="w-3.5 h-3.5" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              Update
            </button>
          </div>
        )}
      </div>

      {/* Empty state */}
      {!selectedExpiry && (
        <div className="flex-1 flex items-center justify-center text-muted type-subhead">
          Select an expiry to load the chain.
        </div>
      )}

      {selectedExpiry && strikes.length === 0 && !loading && (
        <div className="flex-1 flex items-center justify-center text-muted type-subhead">
          No instruments found for this expiry.
        </div>
      )}

      {selectedExpiry && loading && strikes.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <Spinner className="w-5 h-5 text-muted" />
        </div>
      )}

      {/* Chain table */}
      {selectedExpiry && strikes.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-surface-section border-b border-border-strong">
              <tr>
                {/* Call headers */}
                <th className="px-3 py-2 text-right type-micro font-semibold text-muted uppercase tracking-wider whitespace-nowrap">
                  Mark
                </th>
                <th className="px-3 py-2 text-right type-micro font-semibold text-muted uppercase tracking-wider whitespace-nowrap">
                  Delta
                </th>
                <th className="px-3 py-2 text-right type-micro font-semibold text-emerald-500 uppercase tracking-wider whitespace-nowrap">
                  Calls
                </th>
                {/* Strike */}
                <th className="px-4 py-2 text-center type-micro font-semibold text-muted uppercase tracking-wider bg-surface-section border-x border-border-default whitespace-nowrap">
                  Strike
                </th>
                {/* Put headers */}
                <th className="px-3 py-2 text-left type-micro font-semibold text-rose-500 uppercase tracking-wider whitespace-nowrap">
                  Puts
                </th>
                <th className="px-3 py-2 text-left type-micro font-semibold text-muted uppercase tracking-wider whitespace-nowrap">
                  Delta
                </th>
                <th className="px-3 py-2 text-left type-micro font-semibold text-muted uppercase tracking-wider whitespace-nowrap">
                  Mark
                </th>
              </tr>
            </thead>
            <tbody>
              {strikes.map((strike) => (
                <ChainRow
                  key={strike}
                  strike={strike}
                  callInstrument={callsByStrike.get(strike)}
                  putInstrument={putsByStrike.get(strike)}
                  tickers={tickers}
                  positions={positions}
                  expiry={selectedExpiry}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
