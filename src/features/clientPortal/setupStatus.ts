export type SetupStatus = {
  appropriateness: boolean
  strategy: boolean
  riskLimits: boolean
  tradingKey: boolean
}

export const EMPTY_SETUP_STATUS: SetupStatus = {
  appropriateness: false,
  strategy: false,
  riskLimits: false,
  tradingKey: false,
}

export function canActivate(s: SetupStatus): boolean {
  return s.appropriateness && s.strategy && s.riskLimits && s.tradingKey
}

export function outstandingItems(s: SetupStatus): string[] {
  const out: string[] = []
  if (!s.appropriateness) out.push('Appropriateness self-assessment')
  if (!s.strategy) out.push('Strategy selection')
  if (!s.riskLimits) out.push('Risk limits')
  if (!s.tradingKey) out.push('Active trading API key')
  return out
}
