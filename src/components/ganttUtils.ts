import type { Position } from '../utils'
import { STRUCTURE_TYPES } from './dndUtils'

/* ── short strategy names ──────────────────────────────────────────── */

// Reverse lookup: full label → short code, built from the canonical STRUCTURE_TYPES
const LABEL_TO_CODE: Map<string, string> = new Map(STRUCTURE_TYPES.map((t) => [t.label, t.code]))

export function shortStrategy(p: Position): string | null {
  if (p.strategyCode) return p.strategyCode.toUpperCase()
  if (p.strategy) return LABEL_TO_CODE.get(p.strategy) ?? p.strategy
  return null
}

/* ── shortened title (legs only, no date) ──────────────────────────── */

function legLabel(leg: { optionType: string; strike: number }): string {
  const t = leg.optionType === 'P' || leg.optionType === 'C' ? leg.optionType : '?'
  const s = Number.isFinite(leg.strike) ? String(leg.strike) : '?'
  return `${t}${s}`
}

export function ganttBarTitle(p: Position): string {
  const legsPart = p.legs.map((l) => legLabel(l)).join('-')
  return legsPart || p.strategy || p.structureId || p.id
}

/* ── expiry formatting ─────────────────────────────────────────────── */

export function fmtExpiryShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

/* ── PnL classification ────────────────────────────────────────────── */

export type PnlClass = 'profit' | 'loss' | 'neutral'

export function classifyPnl(pnlPct: number | null | undefined): PnlClass {
  if (pnlPct == null) return 'neutral'
  if (pnlPct >= 35) return 'profit'
  if (pnlPct < -50) return 'loss'
  return 'neutral'
}

export function pnlBgClass(c: PnlClass): string {
  if (c === 'profit') return 'bg-status-success-bg'
  if (c === 'loss') return 'bg-status-danger-bg'
  return ''
}

export function pnlTextClass(c: PnlClass): string {
  if (c === 'profit') return 'text-status-success'
  if (c === 'loss') return 'text-status-danger'
  return 'text-text-secondary'
}

export function pnlBorderClass(c: PnlClass): string {
  if (c === 'profit') return 'border-status-success-border'
  if (c === 'loss') return 'border-status-danger-border'
  return 'border-border-default'
}

/* ── column mapping ────────────────────────────────────────────────── */

export function getPositionColumns(
  p: Position,
  expiryIndexMap: Map<string, number>,
): { colStart: number; colEnd: number } | null {
  // Collect unique leg expiries
  const legExpiries = Array.from(
    new Set(p.legs.map((l) => l.expiry).filter(Boolean) as string[]),
  ).sort()

  const expiries = legExpiries.length > 0 ? legExpiries : p.expiryISO ? [p.expiryISO] : []
  if (expiries.length === 0) return null

  const earliest = expiries[0]
  const latest = expiries[expiries.length - 1]

  const start = expiryIndexMap.get(earliest)
  const end = expiryIndexMap.get(latest)
  if (start == null || end == null) return null

  // CSS grid columns are 1-based; colEnd is exclusive
  return { colStart: start + 1, colEnd: end + 2 }
}

/* ── row stacking (greedy bin-packing) ─────────────────────────────── */

export interface PlacedBar {
  position: Position
  colStart: number
  colEnd: number
  row: number
}

export function stackBars(
  positions: Position[],
  expiryIndexMap: Map<string, number>,
): PlacedBar[] {
  const items: { position: Position; colStart: number; colEnd: number }[] = []

  for (const p of positions) {
    const cols = getPositionColumns(p, expiryIndexMap)
    if (cols) items.push({ position: p, ...cols })
  }

  // Sort by colStart asc, then wider bars first
  items.sort((a, b) => a.colStart - b.colStart || (b.colEnd - b.colStart) - (a.colEnd - a.colStart))

  // Each structure gets its own row
  const placed: PlacedBar[] = items.map((item, i) => ({ ...item, row: i }))

  return placed
}
