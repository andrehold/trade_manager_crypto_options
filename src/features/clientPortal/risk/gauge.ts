export type LimitStatus = 'ok' | 'near' | 'breach'

export type GaugeModel = {
  markerPct: number
  safeStartPct: number
  safeWidthPct: number
  zeroPct: number | null
}

const clamp = (x: number) => Math.max(0, Math.min(100, x))

export function paddedDomain(safeLo: number, safeHi: number, padFrac = 0.3): [number, number] {
  const pad = (safeHi - safeLo) * padFrac
  return [safeLo - pad, safeHi + pad]
}

export function rangeGauge(
  value: number, domLo: number, domHi: number, safeLo: number, safeHi: number,
): GaugeModel {
  const span = domHi - domLo
  return {
    markerPct: clamp(((value - domLo) / span) * 100),
    safeStartPct: clamp(((safeLo - domLo) / span) * 100),
    safeWidthPct: clamp(((safeHi - safeLo) / span) * 100),
    zeroPct: domLo <= 0 && domHi >= 0 ? clamp(((0 - domLo) / span) * 100) : null,
  }
}

export function bandStatus(value: number, safeLo: number, safeHi: number, nearFrac = 0.2): LimitStatus {
  if (value < safeLo || value > safeHi) return 'breach'
  const t = (value - safeLo) / (safeHi - safeLo)
  return t < nearFrac || t > 1 - nearFrac ? 'near' : 'ok'
}

export function capStatus(value: number, cap: number, nearFrac = 0.6): LimitStatus {
  const m = Math.abs(value)
  if (m > cap) return 'breach'
  return m / cap > nearFrac ? 'near' : 'ok'
}

export type TwoStageModel = {
  markerPct: number
  amberStartPct: number
  redStartPct: number
  status: LimitStatus
}

export function twoStageGauge(value: number, reduce: number, stop: number, domHi: number): TwoStageModel {
  const pct = (x: number) => clamp((x / domHi) * 100)
  const status: LimitStatus = value >= stop ? 'breach' : value >= reduce ? 'near' : 'ok'
  return { markerPct: pct(value), amberStartPct: pct(reduce), redStartPct: pct(stop), status }
}
