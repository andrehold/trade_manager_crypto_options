import type { PortfolioSummary } from '../portfolio'

export type SeriesPoint = { t: string; v: number }

const DAYS = 30

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export function buildSeries(
  seed: number,
  opts: { start: number; drift: number; vol: number; points?: number; endValue?: number },
): SeriesPoint[] {
  const points = opts.points ?? DAYS
  const rand = seeded(seed)
  const out: SeriesPoint[] = []
  let v = opts.start
  for (let i = 0; i < points; i++) {
    v += opts.drift + (rand() - 0.5) * opts.vol
    out.push({ t: isoDaysAgo(points - 1 - i), v })
  }
  if (opts.endValue != null && out.length > 0) out[out.length - 1].v = opts.endValue
  return out
}

export function equitySeries(summary: PortfolioSummary): SeriesPoint[] {
  const end = summary.totalEquity
  return buildSeries(11, { start: end * 0.77, drift: end * 0.008, vol: Math.abs(end) * 0.06 + 1e-9, endValue: end })
}

export function pnlSeries(summary: PortfolioSummary): SeriesPoint[] {
  const end = summary.totalPnl ?? 0
  return buildSeries(31, { start: end * 0.13, drift: end * 0.03, vol: Math.abs(end) * 0.28 + 1e-9, endValue: end })
}

export function greekSeries(
  key: 'delta' | 'gamma' | 'vega' | 'theta',
  endValue: number,
): SeriesPoint[] {
  const seeds = { delta: 41, gamma: 47, vega: 53, theta: 59 } as const
  const mag = Math.abs(endValue) || 1
  return buildSeries(seeds[key], { start: endValue * 0.6, drift: 0, vol: mag * 0.5, endValue })
}
