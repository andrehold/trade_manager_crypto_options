import React from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/Button'
import { ClientSidebar } from './ClientSidebar'
import { ActivationControl } from './ActivationControl'
import { ResponsibilityStrip } from './ResponsibilityStrip'
import { DashboardPage } from './pages/DashboardPage'
import { PositionsPage } from './pages/PositionsPage'
import { useClientPositions } from './useClientPositions'
import { usePositionInterventions } from './usePositionInterventions'
import { useSetupPersistence } from './useSetupPersistence'
import { type AppropriatenessInput } from '@/lib/clientPortal/appropriatenessRepo'
import { parsePortalPage, portalHash, type PortalPage } from './routing'
import { RiskPage } from './risk/RiskPage'
import { DEFAULT_RISK_LIMITS, type RiskLimits } from './risk/riskLimits'
import type { ExchangeKey, AddKeyInput } from '@/lib/clientPortal/exchangeKeysRepo'
import { EMPTY_SETUP_STATUS, type SetupStatus } from './setupStatus'
import { AppropriatenessPage } from './pages/AppropriatenessPage'
import { StrategyPage } from './pages/StrategyPage'
import { KeysPage } from './pages/KeysPage'
import { UpdatesPage } from './pages/UpdatesPage'
import { AuditLogPage } from './pages/AuditLogPage'
import { newEvent, SEED_AUDIT_EVENTS, type AuditEvent, type AuditType } from './audit'
import { SAMPLE_POSITIONS, SAMPLE_MARKS } from './sampleData'

const PAGE_TITLES: Record<PortalPage, string> = {
  dashboard: 'Dashboard', positions: 'Positions', appropriateness: 'Appropriateness',
  strategy: 'Strategy module', risk: 'Risk & deployment', keys: 'Exchange API keys',
  updates: 'Software updates', audit: 'Audit log',
}

export function ClientPortalShell({ clientName, program, hash, onSignOut }: {
  clientName: string; program: string; hash: string; onSignOut: () => void
}) {
  const page = parsePortalPage(hash)
  const [active, setActive] = React.useState(false)
  const { positions, loading, error, reload } = useClientPositions(clientName)
  const { interventions, record } = usePositionInterventions(clientName)
  const persistence = useSetupPersistence(clientName)
  // Fall back to clearly-labeled illustrative positions when the client has none yet,
  // so the Dashboard/Positions pages demonstrate the UI instead of sitting empty.
  const usingSample = !loading && !error && positions.length === 0
  const shownPositions = usingSample ? SAMPLE_POSITIONS : positions
  const shownMarks = usingSample ? SAMPLE_MARKS : undefined
  const [setupStatus, setSetupStatus] = React.useState<SetupStatus>(EMPTY_SETUP_STATUS)
  const [riskLimits, setRiskLimits] = React.useState<RiskLimits | null>(null)
  const effectiveLimits = riskLimits ?? DEFAULT_RISK_LIMITS
  const [exchangeKeys, setExchangeKeys] = React.useState<ExchangeKey[] | null>(null)
  const effectiveKeys = exchangeKeys ?? []
  const [auditEvents, setAuditEvents] = React.useState<AuditEvent[]>(SEED_AUDIT_EVENTS)
  const [strategy, setStrategy] = React.useState<string | null>(null)
  const [persistError, setPersistError] = React.useState<string | null>(null)
  // Seed the three persisted preconditions from the DB once the fetch resolves. Promote-only
  // (`s.x || …`) so a precondition the client set locally before the fetch resolved is never
  // reverted by a stale "no record" seed.
  React.useEffect(() => {
    if (!persistence.loaded) return
    setSetupStatus((s) => ({
      ...s,
      appropriateness: s.appropriateness || persistence.appropriatenessSigned,
      strategy: s.strategy || !!persistence.selectedStrategy,
      riskLimits: s.riskLimits || !!persistence.savedRiskLimits,
      tradingKey: s.tradingKey || persistence.activeKeys.length > 0,
    }))
    if (persistence.selectedStrategy) setStrategy((cur) => cur ?? persistence.selectedStrategy)
    if (persistence.savedRiskLimits) setRiskLimits((cur) => cur ?? persistence.savedRiskLimits)
    if (persistence.activeKeys.length > 0) setExchangeKeys((cur) => cur ?? persistence.activeKeys)
  }, [persistence.loaded, persistence.appropriatenessSigned, persistence.selectedStrategy, persistence.savedRiskLimits, persistence.activeKeys])
  const appendAudit = React.useCallback((type: AuditType, detail: string, actor: 'client' | 'system' = 'client') => {
    setAuditEvents((evs) => [newEvent(type, detail, actor), ...evs])
  }, [])
  const applyRisk = React.useCallback(async (next: RiskLimits) => {
    const r = await persistence.saveRiskLimits(next)
    if (!r.ok) { setPersistError(r.error ?? 'Could not save your risk limits. Please try again.'); return }
    setPersistError(null)
    setRiskLimits(next)
    setSetupStatus((s) => ({ ...s, riskLimits: true }))
    appendAudit('RISK_PARAM', 'risk & greek limits applied')
  }, [persistence.saveRiskLimits, appendAudit])
  const signAppropriateness = React.useCallback(async (payload: { answers: number[]; attestations: boolean[] }) => {
    const input: AppropriatenessInput = { answers: payload.answers, attestations: payload.attestations, signedName: clientName }
    const r = await persistence.saveAppropriateness(input)
    if (!r.ok) { setPersistError(r.error ?? 'Could not save your assessment. Please try again.'); return }
    setPersistError(null)
    setSetupStatus((s) => ({ ...s, appropriateness: true }))
    appendAudit('APPROPRIATENESS', 'self-assessment completed & signed')
  }, [persistence.saveAppropriateness, appendAudit, clientName])
  const selectStrategy = React.useCallback(async (name: string) => {
    const r = await persistence.saveStrategy(name)
    if (!r.ok) { setPersistError(r.error ?? 'Could not save your strategy selection. Please try again.'); return }
    setPersistError(null)
    setStrategy(name)
    setSetupStatus((s) => ({ ...s, strategy: true }))
    appendAudit('STRATEGY', `selected module "${name}"`)
  }, [persistence.saveStrategy, appendAudit])
  const addTradingKey = React.useCallback(async (input: AddKeyInput) => {
    const r = await persistence.addExchangeKey(input)
    if (!r.ok || !r.keyRef) { setPersistError(r.error ?? 'Could not save your key. Please try again.'); return }
    setPersistError(null)
    const newKey: ExchangeKey = { keyRef: r.keyRef, venue: input.venue, label: input.label, fingerprint: input.fingerprint, scopes: 'trade,read', noWithdrawal: input.noWithdrawal, ts: new Date().toISOString() }
    setExchangeKeys((cur) => [...(cur ?? []), newKey])
    setSetupStatus((s) => ({ ...s, tradingKey: true }))
    appendAudit('API_KEY', `added ${input.venue} key "${input.label}" · scope trade,read · no-withdraw`)
  }, [persistence.addExchangeKey, appendAudit])

  const revokeKey = React.useCallback(async (keyRef: string) => {
    const r = await persistence.revokeExchangeKey(keyRef)
    if (!r.ok) { setPersistError(r.error ?? 'Could not revoke your key. Please try again.'); return }
    setPersistError(null)
    const revoked = (exchangeKeys ?? []).find((k) => k.keyRef === keyRef)
    const next = (exchangeKeys ?? []).filter((k) => k.keyRef !== keyRef)
    setExchangeKeys(next)
    setSetupStatus((s) => ({ ...s, tradingKey: next.length > 0 }))
    appendAudit('API_KEY', revoked ? `revoked ${revoked.venue} key "${revoked.label}"` : `revoked exchange key "${keyRef}"`)
  }, [persistence.revokeExchangeKey, exchangeKeys, appendAudit])
  const approveUpdate = React.useCallback((ver: string) => {
    appendAudit('UPDATE', `reviewed & approved ${ver} → installed`)
  }, [appendAudit])
  const toggleActivation = React.useCallback(() => {
    setActive((a) => {
      const next = !a
      appendAudit(next ? 'ACTIVATION' : 'DEACTIVATION', next ? 'software activated' : 'software deactivated')
      return next
    })
  }, [appendAudit])

  const navigate = React.useCallback((p: PortalPage) => { window.location.hash = portalHash(p) }, [])

  return (
    <div className="flex min-h-screen bg-bg-canvas">
      <ClientSidebar
        clientName={clientName} program={program} active={page}
        setupStatus={setupStatus} onNavigate={navigate} onSignOut={onSignOut}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border-default bg-bg-canvas/80 px-6 py-3 backdrop-blur">
          <div className="type-subhead font-semibold text-text-primary">{PAGE_TITLES[page]}</div>
          <div className="flex-1" />
          <ActivationControl active={active} setupStatus={setupStatus} onToggle={toggleActivation} />
        </header>
        <ResponsibilityStrip onOpenAudit={() => navigate('audit')} />
        <main className="mx-auto w-full max-w-[1140px] flex-1 px-6 py-6">
          {persistError && (
            <div className="mb-4 rounded-xl border border-status-danger/30 bg-status-danger/10 px-4 py-2.5 type-caption text-status-danger">
              {persistError}
            </div>
          )}
          {page === 'risk' ? (
            <RiskPage limits={effectiveLimits} onApply={applyRisk} />
          ) : page === 'appropriateness' ? (
            <AppropriatenessPage signed={setupStatus.appropriateness} onSign={signAppropriateness} />
          ) : page === 'strategy' ? (
            <StrategyPage selected={strategy} onSelect={selectStrategy} />
          ) : page === 'keys' ? (
            <KeysPage keys={effectiveKeys} onAddKey={addTradingKey} onRevokeKey={revokeKey} />
          ) : page === 'updates' ? (
            <UpdatesPage onApprove={approveUpdate} />
          ) : page === 'audit' ? (
            <AuditLogPage events={auditEvents} clientName={clientName} />
          ) : (page === 'dashboard' || page === 'positions') ? (
            error ? (
              <div className="rounded-2xl border border-status-danger/30 bg-status-danger/10 p-6 text-center">
                <p className="type-subhead text-status-danger">Could not load your positions.</p>
                <p className="mt-1 type-caption text-text-secondary">{error}</p>
                <div className="mt-4"><Button variant="secondary" size="sm" onClick={reload}>Retry</Button></div>
              </div>
            ) : loading ? (
              <div className="grid place-items-center py-20"><Spinner className="h-6 w-6" /></div>
            ) : (
              <div className="flex flex-col gap-4">
                {usingSample && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-default bg-bg-surface-2 px-4 py-2.5 type-caption text-text-secondary">
                    <span className="rounded-full bg-status-info/15 px-2 py-0.5 text-[10.5px] font-semibold text-status-info">Sample data</span>
                    Illustrative positions shown because no live positions are loaded yet — they update to your own once positions are available.
                  </div>
                )}
                {page === 'positions' ? (
                  <PositionsPage
                    positions={shownPositions}
                    marks={shownMarks}
                    interventions={interventions}
                    onModify={(positionId) => {
                      record(positionId, 'modify', { persist: !usingSample })
                      appendAudit('POSITION', `modify requested · ${positionId}`)
                    }}
                    onClose={(positionId) => {
                      record(positionId, 'close', { persist: !usingSample })
                      appendAudit('POSITION', `manual close · ${positionId} · client override`)
                    }}
                  />
                ) : (
                  <DashboardPage positions={shownPositions} marks={shownMarks} setupStatus={setupStatus} onNavigate={navigate} />
                )}
              </div>
            )
          ) : (
            <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-8 text-center type-subhead text-text-secondary">
              {PAGE_TITLES[page]} — coming in a later phase.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
