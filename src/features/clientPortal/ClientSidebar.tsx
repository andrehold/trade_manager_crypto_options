import type React from 'react'
import { LayoutDashboard, TrendingUp, ClipboardCheck, BookOpen, ShieldCheck, KeyRound, ArrowDownToLine, FileText, LogOut, Check } from 'lucide-react'
import type { PortalPage } from './routing'
import type { SetupStatus } from './setupStatus'

type Item = { page: PortalPage; label: string; icon: React.ComponentType<{ className?: string }>; statusKey?: keyof SetupStatus }

const TOP: Item[] = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'positions', label: 'Positions', icon: TrendingUp },
]
const SETUP: Item[] = [
  { page: 'appropriateness', label: 'Appropriateness', icon: ClipboardCheck, statusKey: 'appropriateness' },
  { page: 'strategy', label: 'Strategy module', icon: BookOpen, statusKey: 'strategy' },
  { page: 'risk', label: 'Risk & deployment', icon: ShieldCheck, statusKey: 'riskLimits' },
  { page: 'keys', label: 'Exchange keys', icon: KeyRound, statusKey: 'tradingKey' },
  { page: 'updates', label: 'Updates', icon: ArrowDownToLine },
]
const RECORD: Item[] = [{ page: 'audit', label: 'Audit log', icon: FileText }]

function NavButton({ item, active, done, onNavigate }: { item: Item; active: boolean; done?: boolean; onNavigate: (p: PortalPage) => void }) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={() => onNavigate(item.page)}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 type-subhead text-left transition-colors ${active ? 'bg-accent-500/15 text-accent-400 border border-accent-500/40' : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary border border-transparent'}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{item.label}</span>
      {item.statusKey && (done
        ? <Check className="h-3.5 w-3.5 text-status-success" />
        : <span className="h-1.5 w-1.5 rounded-full bg-status-warning" />)}
    </button>
  )
}

export function ClientSidebar({
  clientName, program, active, setupStatus, onNavigate, onSignOut,
}: { clientName: string; program: string; active: PortalPage; setupStatus: SetupStatus; onNavigate: (page: PortalPage) => void; onSignOut: () => void }) {
  return (
    <aside className="flex h-screen w-[244px] shrink-0 flex-col border-r border-border-default bg-bg-elevated">
      <div className="flex items-center gap-3 border-b border-border-default px-4 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-xl border border-accent-500/40 bg-bg-surface-2 type-subhead font-bold text-accent-400">
          {clientName.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="type-subhead font-semibold text-text-primary">{clientName}</div>
          <div className="type-caption text-text-tertiary">{program}</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-1">
          {TOP.map((it) => <NavButton key={it.page} item={it} active={active === it.page} onNavigate={onNavigate} />)}
        </div>
        <div className="px-2 pb-1.5 pt-4 type-caption uppercase tracking-wider text-text-tertiary">Setup &amp; controls</div>
        <div className="flex flex-col gap-1">
          {SETUP.map((it) => <NavButton key={it.page} item={it} active={active === it.page} done={it.statusKey ? setupStatus[it.statusKey] : undefined} onNavigate={onNavigate} />)}
        </div>
        <div className="px-2 pb-1.5 pt-4 type-caption uppercase tracking-wider text-text-tertiary">Record</div>
        <div className="flex flex-col gap-1">
          {RECORD.map((it) => <NavButton key={it.page} item={it} active={active === it.page} onNavigate={onNavigate} />)}
        </div>
      </nav>
      <div className="border-t border-border-default p-3">
        <button type="button" onClick={onSignOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 type-subhead text-text-secondary hover:bg-bg-surface-2 hover:text-status-danger">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  )
}
