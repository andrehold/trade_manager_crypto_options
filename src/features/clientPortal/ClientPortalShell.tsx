import React from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/Button'
import { ClientSidebar } from './ClientSidebar'
import { ActivationControl } from './ActivationControl'
import { ResponsibilityStrip } from './ResponsibilityStrip'
import { DashboardPage } from './pages/DashboardPage'
import { PositionsPage } from './pages/PositionsPage'
import { useClientPositions } from './useClientPositions'
import { parsePortalPage, portalHash, type PortalPage } from './routing'
import { RiskPage } from './risk/RiskPage'
import { DEFAULT_RISK_LIMITS, type RiskLimits } from './risk/riskLimits'
import { EMPTY_SETUP_STATUS, type SetupStatus } from './setupStatus'

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
  const [setupStatus, setSetupStatus] = React.useState<SetupStatus>(EMPTY_SETUP_STATUS)
  const [riskLimits, setRiskLimits] = React.useState<RiskLimits>(DEFAULT_RISK_LIMITS)
  const applyRiskLimits = React.useCallback((next: RiskLimits) => {
    setRiskLimits(next)
    setSetupStatus((s) => ({ ...s, riskLimits: true }))
  }, [])

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
          <ActivationControl active={active} setupStatus={setupStatus} onToggle={() => setActive((v) => !v)} />
        </header>
        <ResponsibilityStrip onOpenAudit={() => navigate('audit')} />
        <main className="mx-auto w-full max-w-[1140px] flex-1 px-6 py-6">
          {page === 'risk' ? (
            <RiskPage limits={riskLimits} onApply={applyRiskLimits} />
          ) : (page === 'dashboard' || page === 'positions') ? (
            error ? (
              <div className="rounded-2xl border border-status-danger/30 bg-status-danger/10 p-6 text-center">
                <p className="type-subhead text-status-danger">Could not load your positions.</p>
                <p className="mt-1 type-caption text-text-secondary">{error}</p>
                <div className="mt-4"><Button variant="secondary" size="sm" onClick={reload}>Retry</Button></div>
              </div>
            ) : loading ? (
              <div className="grid place-items-center py-20"><Spinner className="h-6 w-6" /></div>
            ) : page === 'positions' ? (
              <PositionsPage positions={positions} onModify={(id) => console.debug('modify', id)} onClose={(id) => console.debug('close', id)} />
            ) : (
              <DashboardPage positions={positions} setupStatus={setupStatus} onNavigate={navigate} />
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
