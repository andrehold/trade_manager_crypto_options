// Illustrative sample positions + marks for the client portal, shown only when
// the signed-in client has no real positions yet, so the Dashboard and Positions
// pages demonstrate the UI (like the design mockup). These are NOT real holdings —
// the shell labels them as sample data. Replaced entirely once real positions load.
import { getLegMarkRef, daysTo, type Position, type Leg, type MarksMap } from '@/utils'

const UNDERLYING = 'BTC'
const PROGRAM = 'Weekend Vol (Short-Dated)'

type LegSpec = {
  strike: number
  optionType: 'C' | 'P'
  sign: 1 | -1
  entry: number
  mark: number
  greeks: { delta: number; gamma: number; theta: number; vega: number; rho: number }
}

// A short iron condor: long the wings (89000P / 92000C), short the inner strikes
// (90000P / 91000C) → net short gamma/vega, positive theta (a premium-selling profile).
const CONDOR_LEGS: LegSpec[] = [
  { strike: 89000, optionType: 'P', sign: 1, entry: 0.0021, mark: 0.0018, greeks: { delta: -0.10, gamma: 0.00002, theta: -0.0004, vega: 0.0008, rho: -0.02 } },
  { strike: 90000, optionType: 'P', sign: -1, entry: 0.0045, mark: 0.0038, greeks: { delta: -0.18, gamma: 0.00003, theta: -0.0006, vega: 0.0011, rho: -0.03 } },
  { strike: 91000, optionType: 'C', sign: -1, entry: 0.0031, mark: 0.0026, greeks: { delta: 0.20, gamma: 0.00003, theta: -0.0006, vega: 0.0011, rho: 0.03 } },
  { strike: 92000, optionType: 'C', sign: 1, entry: 0.0013, mark: 0.0010, greeks: { delta: 0.11, gamma: 0.00002, theta: -0.0004, vega: 0.0008, rho: 0.02 } },
]

function isoInDays(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function buildCondor(
  id: string,
  dteOffset: number,
  netPremium: number,
  realizedPnl: number,
  status: Position['status'],
): { position: Position; marks: MarksMap } {
  const expiry = isoInDays(dteOffset)
  const legs: Leg[] = CONDOR_LEGS.map((s) => ({
    key: `${id}-${s.strike}-${s.optionType}`,
    strike: s.strike,
    optionType: s.optionType,
    openLots: [{ qty: 1, price: s.entry, sign: s.sign }],
    realizedPnl: 0,
    netPremium: 0,
    qtyNet: s.sign,
    trades: [],
    exchange: 'deribit',
    expiry,
  }))

  const position: Position = {
    id,
    underlying: UNDERLYING,
    expiryISO: expiry,
    dte: daysTo(expiry),
    legs,
    legsCount: legs.length,
    type: 'Multi-leg',
    strategy: 'Iron Condor',
    realizedPnl,
    netPremium,
    status,
    greeks: {},
    programName: PROGRAM,
    structureId: id,
    exchange: 'deribit',
    source: 'local',
    clientName: null,
  }

  const marks: MarksMap = {}
  legs.forEach((leg, i) => {
    const ref = getLegMarkRef(position, leg)
    if (ref) marks[ref.key] = { price: CONDOR_LEGS[i].mark, multiplier: 1, greeks: CONDOR_LEGS[i].greeks }
  })

  return { position, marks }
}

const CONDORS = [
  buildCondor('sample-ic-1', 5, 0.0042, 0.0040, 'ATTENTION'),
  buildCondor('sample-ic-2', 12, 0.0061, 0.0011, 'OPEN'),
  buildCondor('sample-ic-3', 26, 0.0159, 0.0012, 'OPEN'),
]

export const SAMPLE_POSITIONS: Position[] = CONDORS.map((c) => c.position)

export const SAMPLE_MARKS: MarksMap = CONDORS.reduce<MarksMap>((acc, c) => Object.assign(acc, c.marks), {})
