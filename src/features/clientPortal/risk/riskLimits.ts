export type Band = { min: number; max: number }

export type RiskLimits = {
  // Deployment
  capitalTvlBtc: number
  maxConcurrent: number
  expiryMinDte: number
  expiryMaxDte: number
  autoRoll: boolean
  // Greek limits (% of TVL)
  deltaLongGamma: Band   // Γ > 0
  deltaShortGamma: Band  // Γ < 0
  gammaFloor: number
  gammaCap: number
  vega: Band
  thetaFloor: number
  // Stress & aggregate (% of TVL)
  stressLossMaxPct: number
  netDeltaMaxPct: number
  drawdownReducePct: number
  drawdownStopPct: number
}

export type GreekReadings = {
  deltaPct: number
  gammaPct: number
  vegaPct: number
  thetaPct: number
  stressWorstPct: number // magnitude of the worst-case loss, % of TVL
  netDeltaPct: number    // absolute
  drawdownPct: number    // current drawdown, % of TVL
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  capitalTvlBtc: 0.03,
  maxConcurrent: 3,
  expiryMinDte: 1,
  expiryMaxDte: 3,
  autoRoll: false,
  deltaLongGamma: { min: -60, max: 60 },
  deltaShortGamma: { min: -10, max: 10 },
  gammaFloor: -10,
  gammaCap: 0,
  vega: { min: -0.5, max: 0.5 },
  thetaFloor: -2,
  stressLossMaxPct: 5,
  netDeltaMaxPct: 10,
  drawdownReducePct: 20,
  drawdownStopPct: 33,
}

// Placeholder live readings until a greek engine + live marks are wired (later phase).
export const ILLUSTRATIVE_READINGS: GreekReadings = {
  deltaPct: 3.2,
  gammaPct: -8.1,
  vegaPct: -0.28,
  thetaPct: 0.8,
  stressWorstPct: 3.4,
  netDeltaPct: 3.2,
  drawdownPct: 6.7,
}

export function activeDeltaBand(
  limits: RiskLimits,
  readings: GreekReadings,
): { band: Band; regime: 'long' | 'short' } {
  return readings.gammaPct < 0
    ? { band: limits.deltaShortGamma, regime: 'short' }
    : { band: limits.deltaLongGamma, regime: 'long' }
}
