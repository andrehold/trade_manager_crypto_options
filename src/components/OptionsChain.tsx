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
  btcSpot: number | null
}

type StrikeMarker = 'atm' | '1s' | '2s' | null

function fmtMark(v: number | undefined | null): string {
  if (v == null) return '—'
  return v.toFixed(4)
}

function fmtMid(bid: number | undefined | null, ask: number | undefined | null): string {
  if (bid == null || ask == null) return '—'
  return ((bid + ask) / 2).toFixed(4)
}

function midVsMarkClass(bid: number | undefined | null, ask: number | undefined | null, mark: number | undefined | null): string {
  if (bid == null || ask == null || mark == null) return 'text-muted'
  const mid = (bid + ask) / 2
  const diff = mid - mark
  const threshold = mark * 0.005 // 0.5% of mark
  if (diff > threshold) return 'text-emerald-400'
  if (diff < -threshold) return 'text-rose-400'
  return 'text-subtle'
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

function daysToExpiry(expiryISO: string): number {
  const now = Date.now()
  const exp = new Date(expiryISO + 'T08:00:00Z').getTime() // Deribit settles at 08:00 UTC
  return Math.max(0, (exp - now) / (1000 * 60 * 60 * 24))
}

// Find the nearest strike to a target price from a sorted array of strikes
function nearestStrike(strikes: number[], target: number): number {
  let best = strikes[0]
  let bestDist = Math.abs(strikes[0] - target)
  for (const s of strikes) {
    const d = Math.abs(s - target)
    if (d < bestDist) { bestDist = d; best = s }
  }
  return best
}

// Normal CDF approximation (Abramowitz & Stegun 26.2.17, max error ~1.5e-7)
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * poly
  return x >= 0 ? 1 - tail : tail
}

// Probability that spot touches barrier K at any time before expiry T,
// using the reflection principle under GBM with risk-neutral drift (r=0).
// Upper barrier (K > spot): P = N(d2) + (spot/K)·N(d1)
// Lower barrier (K < spot): P = N(-d2) + (spot/K)·N(-d1)
function touchProbability(spot: number, strike: number, ivDecimal: number, tYears: number): number {
  if (strike === spot) return 1
  if (tYears <= 0 || ivDecimal <= 0) return 0
  const sqrtT = Math.sqrt(tYears)
  const d1 = (Math.log(spot / strike) + (ivDecimal * ivDecimal * tYears) / 2) / (ivDecimal * sqrtT)
  const d2 = d1 - ivDecimal * sqrtT
  return strike > spot
    ? normalCDF(d2) + (spot / strike) * normalCDF(d1)
    : normalCDF(-d2) + (spot / strike) * normalCDF(-d1)
}

// Compute strike markers given spot, ATM IV (as decimal), and T (years)
function computeMarkers(
  strikes: number[],
  spot: number,
  ivDecimal: number,
  tYears: number,
): Map<number, StrikeMarker> {
  const map = new Map<number, StrikeMarker>()
  if (strikes.length === 0) return map

  const atm = nearestStrike(strikes, spot)
  map.set(atm, 'atm')

  const s1up = spot * Math.exp(ivDecimal * Math.sqrt(tYears))
  const s1dn = spot * Math.exp(-ivDecimal * Math.sqrt(tYears))
  const s2up = spot * Math.exp(2 * ivDecimal * Math.sqrt(tYears))
  const s2dn = spot * Math.exp(-2 * ivDecimal * Math.sqrt(tYears))

  for (const [target, marker] of [
    [s2up, '2s'], [s2dn, '2s'],
    [s1up, '1s'], [s1dn, '1s'],
  ] as [number, StrikeMarker][]) {
    const nearest = nearestStrike(strikes, target)
    // Don't overwrite ATM or a more-precise marker already set
    if (!map.has(nearest)) map.set(nearest, marker)
  }

  return map
}

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
    <span className={[
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums',
      isLong ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400',
    ].join(' ')}>
      {isLong ? '+' : ''}{qty}
    </span>
  )
}

function StrikeMarkerBadge({ marker }: { marker: StrikeMarker }) {
  if (!marker) return null
  if (marker === 'atm') return (
    <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-amber-500/20 text-amber-400 leading-none">
      ATM
    </span>
  )
  if (marker === '1s') return (
    <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-sky-500/20 text-sky-400 leading-none">
      1σ
    </span>
  )
  return (
    <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-indigo-500/20 text-indigo-400 leading-none">
      2σ
    </span>
  )
}

interface ChainRowProps {
  strike: number
  marker: StrikeMarker
  touchProb: number | null
  callInstrument: ChainInstrument | undefined
  putInstrument: ChainInstrument | undefined
  tickers: Map<string, DeribitTickerResult>
  positions: Position[]
  expiry: string
}

function ChainRow({ strike, marker, touchProb, callInstrument, putInstrument, tickers, positions, expiry }: ChainRowProps) {
  const callTicker = callInstrument ? tickers.get(callInstrument.instrument_name) : undefined
  const putTicker = putInstrument ? tickers.get(putInstrument.instrument_name) : undefined

  const callQty = positionNetQty(positions, expiry, strike, 'call')
  const putQty = positionNetQty(positions, expiry, strike, 'put')

  const hasCallPos = callQty !== 0
  const hasPutPos = putQty !== 0

  const isAtm = marker === 'atm'
  const is1s = marker === '1s'
  const is2s = marker === '2s'

  const rowBg =
    hasCallPos || hasPutPos
      ? 'bg-surface-chip/30'
      : isAtm
      ? 'bg-amber-500/5'
      : is1s
      ? 'bg-sky-500/5'
      : is2s
      ? 'bg-indigo-500/5'
      : 'hover:bg-surface-hover/40'

  const strikeBorderColor =
    isAtm ? 'border-x border-amber-500/40' :
    is1s  ? 'border-x border-sky-500/30' :
    is2s  ? 'border-x border-indigo-500/30' :
    'border-x border-border-default'

  return (
    <tr className={['border-b border-border-default transition-colors', rowBg].join(' ')}>
      {/* Call side */}
      <td className={['px-3 py-2 text-right tabular-nums type-caption', hasCallPos ? 'text-heading font-semibold' : 'text-body'].join(' ')}>
        {fmtMark(callTicker?.mark_price)}
      </td>
      <td className={['px-3 py-2 text-right tabular-nums type-caption', midVsMarkClass(callTicker?.best_bid_price, callTicker?.best_ask_price, callTicker?.mark_price)].join(' ')}>
        {fmtMid(callTicker?.best_bid_price, callTicker?.best_ask_price)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums type-caption text-subtle">
        {fmtDelta(callTicker?.greeks?.delta)}
      </td>
      <td className="px-3 py-2 text-right">
        <PositionBadge qty={callQty} />
      </td>

      {/* Strike */}
      <td className={['px-4 py-1.5 text-center bg-surface-section whitespace-nowrap', strikeBorderColor].join(' ')}>
        <div className="flex flex-col items-center gap-0.5">
          <div className={['tabular-nums type-caption font-semibold', isAtm ? 'text-amber-300' : is1s ? 'text-sky-300' : is2s ? 'text-indigo-300' : 'text-heading'].join(' ')}>
            {fmtStrike(strike)}
            <StrikeMarkerBadge marker={marker} />
          </div>
          {touchProb !== null && (
            <span className="text-[9px] font-medium tabular-nums text-muted leading-none" title="Probability of not being touched">
              {((1 - touchProb) * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </td>

      {/* Put side */}
      <td className="px-3 py-2 text-left">
        <PositionBadge qty={putQty} />
      </td>
      <td className="px-3 py-2 text-left tabular-nums type-caption text-subtle">
        {fmtDelta(putTicker?.greeks?.delta)}
      </td>
      <td className={['px-3 py-2 text-left tabular-nums type-caption', midVsMarkClass(putTicker?.best_bid_price, putTicker?.best_ask_price, putTicker?.mark_price)].join(' ')}>
        {fmtMid(putTicker?.best_bid_price, putTicker?.best_ask_price)}
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
  btcSpot,
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

  // Compute per-strike touch probabilities using strike's own IV (vol smile aware)
  const touchProbabilities = React.useMemo<Map<number, number>>(() => {
    if (strikes.length === 0 || !selectedExpiry) return new Map()
    let spot = btcSpot
    if (!spot) {
      for (const t of tickers.values()) { if (t.index_price) { spot = t.index_price; break } }
    }
    if (!spot) return new Map()

    const tYears = daysToExpiry(selectedExpiry) / 365
    if (tYears <= 0) return new Map()

    // Gather ATM IV as fallback
    const atmStrike = nearestStrike(strikes, spot)
    const atmCallIv = (() => {
      const c = callsByStrike.get(atmStrike)
      return c ? tickers.get(c.instrument_name)?.mark_iv : undefined
    })()
    const fallbackIvPct = atmCallIv ?? (() => {
      for (const s of strikes) {
        const c = callsByStrike.get(s)
        const iv = c ? tickers.get(c.instrument_name)?.mark_iv : undefined
        if (iv != null) return iv
      }
      return undefined
    })()

    const map = new Map<number, number>()
    for (const strike of strikes) {
      // Prefer call IV for call-side strikes (K ≥ spot), put IV for put-side (K < spot)
      const callIv = (() => { const c = callsByStrike.get(strike); return c ? tickers.get(c.instrument_name)?.mark_iv : undefined })()
      const putIv = (() => { const p = putsByStrike.get(strike); return p ? tickers.get(p.instrument_name)?.mark_iv : undefined })()
      const ivPct = (strike >= spot ? callIv ?? putIv : putIv ?? callIv) ?? fallbackIvPct
      if (ivPct == null || ivPct <= 0) continue
      map.set(strike, touchProbability(spot, strike, ivPct / 100, tYears))
    }
    return map
  }, [strikes, selectedExpiry, btcSpot, tickers, callsByStrike, putsByStrike])

  // Derive ATM IV from the ATM call ticker's mark_iv
  const strikeMarkers = React.useMemo<Map<number, StrikeMarker>>(() => {
    if (strikes.length === 0 || !selectedExpiry) return new Map()

    // Use btcSpot prop, or fall back to index_price from any loaded ticker
    let spot = btcSpot
    if (!spot) {
      for (const t of tickers.values()) {
        if (t.index_price) { spot = t.index_price; break }
      }
    }
    if (!spot) return new Map()

    const atmStrike = nearestStrike(strikes, spot)
    const atmCall = callsByStrike.get(atmStrike)
    const atmIvPct = atmCall ? tickers.get(atmCall.instrument_name)?.mark_iv : undefined

    // Fall back to scanning nearby strikes for any available IV
    let ivPct = atmIvPct
    if (ivPct == null) {
      for (const s of strikes) {
        const call = callsByStrike.get(s)
        const iv = call ? tickers.get(call.instrument_name)?.mark_iv : undefined
        if (iv != null) { ivPct = iv; break }
      }
    }
    if (ivPct == null || ivPct <= 0) return new Map([[atmStrike, 'atm']])

    const tYears = daysToExpiry(selectedExpiry) / 365
    if (tYears <= 0) return new Map([[atmStrike, 'atm']])

    return computeMarkers(strikes, spot, ivPct / 100, tYears)
  }, [btcSpot, strikes, callsByStrike, tickers, selectedExpiry])

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
              {loading ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Update
            </button>
          </div>
        )}
      </div>

      {/* Legend */}
      {selectedExpiry && strikes.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default">
          <span className="type-micro text-muted">Legend:</span>
          <span className="inline-flex items-center gap-1 type-micro text-amber-400">
            <span className="w-2 h-2 rounded-sm bg-amber-500/40 inline-block" /> ATM
          </span>
          <span className="inline-flex items-center gap-1 type-micro text-sky-400">
            <span className="w-2 h-2 rounded-sm bg-sky-500/40 inline-block" /> 1σ expected move
          </span>
          <span className="inline-flex items-center gap-1 type-micro text-indigo-400">
            <span className="w-2 h-2 rounded-sm bg-indigo-500/40 inline-block" /> 2σ expected move
          </span>
          {(btcSpot ?? Array.from(tickers.values()).find(t => t.index_price)?.index_price) && (
            <span className="ml-auto type-micro text-muted tabular-nums">
              Spot <span className="text-body font-semibold">${(btcSpot ?? Array.from(tickers.values()).find(t => t.index_price)?.index_price)!.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </span>
          )}
        </div>
      )}

      {/* Empty states */}
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
                <th className="px-3 py-2 text-right type-micro font-semibold text-muted uppercase tracking-wider whitespace-nowrap">Mark</th>
                <th className="px-3 py-2 text-right type-micro font-semibold text-muted uppercase tracking-wider whitespace-nowrap">Mid</th>
                <th className="px-3 py-2 text-right type-micro font-semibold text-muted uppercase tracking-wider whitespace-nowrap">Delta</th>
                <th className="px-3 py-2 text-right type-micro font-semibold text-emerald-500 uppercase tracking-wider whitespace-nowrap">Calls</th>
                <th className="px-4 py-2 text-center type-micro font-semibold text-muted uppercase tracking-wider bg-surface-section border-x border-border-default whitespace-nowrap">Strike</th>
                <th className="px-3 py-2 text-left type-micro font-semibold text-rose-500 uppercase tracking-wider whitespace-nowrap">Puts</th>
                <th className="px-3 py-2 text-left type-micro font-semibold text-muted uppercase tracking-wider whitespace-nowrap">Delta</th>
                <th className="px-3 py-2 text-left type-micro font-semibold text-muted uppercase tracking-wider whitespace-nowrap">Mid</th>
                <th className="px-3 py-2 text-left type-micro font-semibold text-muted uppercase tracking-wider whitespace-nowrap">Mark</th>
              </tr>
            </thead>
            <tbody>
              {strikes.map((strike) => (
                <ChainRow
                  key={strike}
                  strike={strike}
                  marker={strikeMarkers.get(strike) ?? null}
                  touchProb={touchProbabilities.get(strike) ?? null}
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
