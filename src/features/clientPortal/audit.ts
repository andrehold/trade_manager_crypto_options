export type AuditActor = 'client' | 'system'

export type AuditType =
  | 'APPROPRIATENESS' | 'STRATEGY' | 'RISK_PARAM' | 'API_KEY'
  | 'ACTIVATION' | 'DEACTIVATION' | 'UPDATE' | 'POSITION' | 'EXECUTION'

export type AuditEvent = {
  id: string
  ts: string
  actor: AuditActor
  type: AuditType
  detail: string
}

let counter = 0

export function newEvent(type: AuditType, detail: string, actor: AuditActor = 'client'): AuditEvent {
  counter += 1
  return {
    id: `evt-${counter}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    actor,
    type,
    detail,
  }
}

export const SEED_AUDIT_EVENTS: AuditEvent[] = [
  { id: 'seed-5', ts: '2026-07-23T09:00:00Z', actor: 'system', type: 'EXECUTION', detail: 'closed BTC-14DEC25 iron condor per client parameters' },
  { id: 'seed-4', ts: '2026-07-23T08:18:20Z', actor: 'client', type: 'ACTIVATION', detail: 'software activated · gate: assessment ✓ keys ✓' },
  { id: 'seed-3', ts: '2026-07-23T08:16:12Z', actor: 'client', type: 'STRATEGY', detail: 'selected module "Weekend Vol (Short-Dated)"' },
  { id: 'seed-2', ts: '2026-07-23T08:15:40Z', actor: 'client', type: 'API_KEY', detail: 'added Deribit key ····9f2a1f9 · scope trade,read · no-withdraw' },
  { id: 'seed-1', ts: '2026-07-23T08:14:02Z', actor: 'client', type: 'APPROPRIATENESS', detail: 'self-assessment completed & signed · valid 12mo' },
]
