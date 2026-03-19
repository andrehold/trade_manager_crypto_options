import React from 'react'
import {
  Zap,
  LayoutDashboard,
  BookOpen,
  GitMerge,
  FileSpreadsheet,
  ChevronLeft,
  LogOut,
  Users,
  Bell,
  Bitcoin,
  Plus,
  UserCircle,
} from 'lucide-react'
import { Toggle } from './Toggle'

export type SidebarNavKey = 'dashboard' | 'playbooks' | 'assignLegs' | 'mapCSV'

export interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  activeNav?: SidebarNavKey
  onNavigateDashboard?: () => void
  onNavigatePlaybooks?: () => void
  onNavigateAssignLegs?: () => void
  onNavigateMapCSV?: () => void
  user: { email?: string | null } | null
  btcSpot: number | null
  btcSpotUpdatedAt: Date | null
  isAdmin: boolean
  selectedClient: string
  clientOptions: string[]
  onSelectClient: (c: string) => void
  onAddClient: () => void
  alertsOnly: boolean
  onToggleAlertsOnly: (v: boolean) => void
  onSignOut: () => void
}

interface NavItemDef {
  key: SidebarNavKey
  icon: React.FC<{ className?: string }>
  label: string
  onClick?: () => void
}

export function Sidebar({
  collapsed,
  onToggle,
  activeNav = 'dashboard',
  onNavigateDashboard,
  onNavigatePlaybooks,
  onNavigateAssignLegs,
  onNavigateMapCSV,
  user,
  btcSpot,
  btcSpotUpdatedAt,
  isAdmin,
  selectedClient,
  clientOptions,
  onSelectClient,
  onAddClient,
  alertsOnly,
  onToggleAlertsOnly,
  onSignOut,
}: SidebarProps) {
  const navItems: NavItemDef[] = [
    { key: 'dashboard', icon: LayoutDashboard, label: 'Dashboard', onClick: onNavigateDashboard },
    { key: 'playbooks', icon: BookOpen, label: 'Playbooks', onClick: onNavigatePlaybooks },
    { key: 'assignLegs', icon: GitMerge, label: 'Assign Legs', onClick: onNavigateAssignLegs },
    { key: 'mapCSV', icon: FileSpreadsheet, label: 'Map CSV', onClick: onNavigateMapCSV },
  ]

  const btcFormatted =
    btcSpot === null
      ? '—'
      : `$${btcSpot.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  return (
    <aside
      className={[
        'flex flex-col bg-surface-page text-heading',
        'sticky top-0 h-screen overflow-y-auto overflow-x-hidden shrink-0',
        'transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-[72px]' : 'w-60',
      ].join(' ')}
    >
      {/* ── Logo + collapse toggle ── */}
      <div
        className={[
          'flex items-center gap-3 px-3 py-4 border-b border-border-default',
          collapsed ? 'justify-center' : '',
        ].join(' ')}
      >
        {collapsed ? (
          <button
            onClick={onToggle}
            aria-label="Expand sidebar"
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-accent-600 text-white shrink-0 hover:bg-accent-700 transition-colors focus:outline-none focus:ring-2 focus:ring-border-accent"
            title="Expand sidebar"
          >
            <Zap className="w-4 h-4" strokeWidth={2.5} />
          </button>
        ) : (
          <button
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-accent-600 text-white shrink-0 hover:bg-accent-700 transition-colors focus:outline-none focus:ring-2 focus:ring-border-accent"
            title="Collapse sidebar"
          >
            <Zap className="w-4 h-4" strokeWidth={2.5} />
          </button>
        )}
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="type-subhead font-semibold leading-tight truncate tracking-tight">
              Trade Desk
            </p>
            <p className="type-micro text-faint leading-tight truncate">
              Demo · Frontend Only
            </p>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="p-1 rounded-xl text-faint hover:text-heading hover:bg-surface-hover transition ml-auto shrink-0 focus:outline-none focus:ring-2 focus:ring-border-accent"
            title="Collapse sidebar"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Main navigation ── */}
      <nav className="flex flex-col gap-0.5 px-2 py-3">
        {navItems.map(({ key, icon: Icon, label, onClick }) => {
          const isActive = activeNav === key
          return (
            <button
              key={key}
              onClick={onClick}
              title={collapsed ? label : undefined}
              className={[
                'flex items-center gap-3 rounded-xl px-3 py-2.5 type-subhead font-medium',
                'transition-colors w-full text-left',
                'focus:outline-none focus:ring-2 focus:ring-border-accent',
                collapsed ? 'justify-center' : '',
                isActive
                  ? 'bg-accent-500/15 text-accent-400'
                  : 'text-faint hover:bg-surface-hover hover:text-heading',
              ].join(' ')}
            >
              <Icon
                className={['w-5 h-5 shrink-0', isActive ? 'text-accent-400' : ''].join(' ')}
              />
              {!collapsed && <span className="truncate">{label}</span>}
            </button>
          )
        })}
      </nav>

      <hr className="mx-3 border-0 border-t border-border-default" />

      {/* ── BTC Spot ── */}
      <div
        className={[
          'flex items-center gap-2.5 px-4 py-3',
          collapsed ? 'justify-center' : '',
        ].join(' ')}
        title={
          btcSpotUpdatedAt
            ? `BTC spot · updated ${btcSpotUpdatedAt.toLocaleTimeString()}`
            : 'BTC spot price'
        }
      >
        <Bitcoin className="w-4 h-4 text-amber-400 shrink-0" />
        {!collapsed && (
          <div className="flex flex-col leading-tight">
            <span className="type-micro font-semibold uppercase tracking-widest text-faint">
              BTC Spot
            </span>
            <span className="type-subhead font-semibold text-heading tabular-nums">{btcFormatted}</span>
          </div>
        )}
      </div>

      {/* ── Add Trade ── */}
      <div className="px-2 pb-3">
        <button
          className={[
            'w-full rounded-xl bg-accent-600 hover:bg-accent-700 active:bg-accent-800',
            'text-white py-2 type-subhead font-semibold transition-colors',
            'flex items-center justify-center gap-2',
            'focus:outline-none focus:ring-2 focus:ring-border-accent',
          ].join(' ')}
          title="Add Trade"
        >
          <Plus className="w-4 h-4 shrink-0" strokeWidth={2.5} />
          {!collapsed && <span>Add Trade</span>}
        </button>
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      <hr className="mx-3 border-0 border-t border-border-default" />

      {/* ── Alerts only ── */}
      <div
        className={[
          'flex items-center gap-3 px-4 py-3',
          collapsed ? 'justify-center' : 'justify-between',
        ].join(' ')}
      >
        <button
          onClick={collapsed ? () => onToggleAlertsOnly(!alertsOnly) : undefined}
          title={collapsed ? (alertsOnly ? 'Alerts on' : 'Alerts off') : undefined}
          aria-label={alertsOnly ? 'Disable alerts filter' : 'Enable alerts filter'}
          className={[
            collapsed ? 'cursor-pointer' : 'cursor-default',
            'focus:outline-none focus:ring-2 focus:ring-border-accent rounded-lg',
          ].join(' ')}
        >
          <Bell
            className={[
              'w-4 h-4 shrink-0',
              alertsOnly ? 'text-amber-400' : 'text-faint',
            ].join(' ')}
          />
        </button>
        {!collapsed && (
          <>
            <span className="flex-1 type-subhead text-body">Alerts only</span>
            <Toggle checked={alertsOnly} onChange={onToggleAlertsOnly} label="Alerts only" />
          </>
        )}
      </div>

      {/* ── Client selector ── */}
      <div className="border-t border-border-default">
        {collapsed ? (
          <div className="flex justify-center px-4 py-3" title={selectedClient}>
            <Users className="w-4 h-4 text-faint" />
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-3">
            <Users className="w-4 h-4 text-faint shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col leading-tight">
              <span className="type-micro font-semibold uppercase tracking-widest text-faint">
                Client
              </span>
              <select
                aria-label="Select client"
                className="w-full bg-surface-chip border border-border-default rounded-lg px-2 py-1 type-subhead font-semibold text-heading hover:border-border-accent transition-colors focus:outline-none focus:ring-2 focus:ring-border-accent disabled:opacity-45 disabled:cursor-not-allowed"
                value={selectedClient}
                onChange={(e) => onSelectClient(e.target.value)}
                disabled={!isAdmin}
              >
                {clientOptions.map((c) => (
                  <option key={c} value={c} className="bg-surface-page text-heading">
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {isAdmin && (
              <button
                onClick={onAddClient}
                aria-label="Add client"
                className="p-1 rounded-lg text-faint hover:text-heading hover:bg-surface-hover transition shrink-0 focus:outline-none focus:ring-2 focus:ring-border-accent"
                title="Add client"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
            {!isAdmin && (
              <span className="type-micro font-semibold uppercase tracking-widest text-muted">
                Locked
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── User + sign out ── */}
      <div
        className={[
          'flex items-center gap-2 px-4 py-3 border-t border-border-default',
          collapsed ? 'justify-center' : '',
        ].join(' ')}
      >
        <UserCircle className="w-4 h-4 text-faint shrink-0" />
        {!collapsed && (
          <span className="flex-1 type-caption text-faint truncate min-w-0">
            {user?.email ?? 'Signed in'}
          </span>
        )}
        <button
          onClick={onSignOut}
          aria-label="Sign out"
          className="p-1 rounded-lg text-faint hover:text-rose-400 hover:bg-surface-hover transition shrink-0 focus:outline-none focus:ring-2 focus:ring-border-accent"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  )
}
