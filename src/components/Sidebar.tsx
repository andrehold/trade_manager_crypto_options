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
        'scheme-light',
        'flex flex-col bg-zinc-950 text-white',
        'sticky top-0 h-screen overflow-y-auto overflow-x-hidden shrink-0',
        'transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-60',
      ].join(' ')}
    >
      {/* ── Logo + collapse toggle ── */}
      <div
        className={[
          'flex items-center gap-3 px-3 py-4 border-b border-zinc-800',
          collapsed ? 'justify-center' : '',
        ].join(' ')}
      >
        {collapsed ? (
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-emerald-500 text-white shrink-0 hover:bg-emerald-600 transition-colors"
            title="Expand sidebar"
          >
            <Zap className="w-4 h-4" strokeWidth={2.5} />
          </button>
        ) : (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-emerald-500 text-white shrink-0">
            <Zap className="w-4 h-4" strokeWidth={2.5} />
          </span>
        )}
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="type-subhead font-semibold leading-tight truncate tracking-tight">
              Trade Desk
            </p>
            <p className="text-[10px] text-slate-400 leading-tight truncate">
              Demo · Frontend Only
            </p>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={onToggle}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-zinc-800 transition ml-auto shrink-0"
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
                collapsed ? 'justify-center' : '',
                isActive
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-slate-400 hover:bg-zinc-900 hover:text-slate-100',
              ].join(' ')}
            >
              <Icon
                className={['w-5 h-5 shrink-0', isActive ? 'text-emerald-400' : ''].join(' ')}
              />
              {!collapsed && <span className="truncate">{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* ── Divider ── */}
      <div className="mx-3 border-t border-zinc-800" />

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
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              BTC Spot
            </span>
            <span className="type-subhead font-semibold text-white tabular-nums">{btcFormatted}</span>
          </div>
        )}
      </div>

      {/* ── Add Trade ── */}
      <div className="px-2 pb-3">
        <button
          className={[
            'w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700',
            'text-white py-2 type-subhead font-semibold transition-colors',
            'flex items-center justify-center gap-2',
          ].join(' ')}
          title="Add Trade"
        >
          <Plus className="w-4 h-4 shrink-0" strokeWidth={2.5} />
          {!collapsed && <span>Add Trade</span>}
        </button>
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Divider ── */}
      <div className="mx-3 border-t border-zinc-800" />

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
          className={collapsed ? 'cursor-pointer' : 'cursor-default'}
        >
          <Bell
            className={[
              'w-4 h-4 shrink-0',
              alertsOnly ? 'text-amber-400' : 'text-slate-400',
            ].join(' ')}
          />
        </button>
        {!collapsed && (
          <>
            <span className="flex-1 type-subhead text-slate-300">Alerts only</span>
            <Toggle checked={alertsOnly} onChange={onToggleAlertsOnly} label="Alerts only" />
          </>
        )}
      </div>

      {/* ── Client selector ── */}
      <div className="border-t border-zinc-800">
        {collapsed ? (
          <div className="flex justify-center px-4 py-3" title={selectedClient}>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-3">
            <Users className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col leading-tight">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Client
              </span>
              <select
                className="bg-transparent type-subhead font-semibold text-white focus:outline-none"
                value={selectedClient}
                onChange={(e) => onSelectClient(e.target.value)}
                disabled={!isAdmin}
              >
                {clientOptions.map((c) => (
                  <option key={c} value={c} className="bg-zinc-950 text-white">
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {isAdmin && (
              <button
                onClick={onAddClient}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-zinc-800 transition shrink-0"
                title="Add client"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
            {!isAdmin && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                Locked
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── User + sign out ── */}
      <div
        className={[
          'flex items-center gap-2 px-4 py-3 border-t border-zinc-800',
          collapsed ? 'justify-center' : '',
        ].join(' ')}
      >
        <UserCircle className="w-4 h-4 text-slate-400 shrink-0" />
        {!collapsed && (
          <span className="flex-1 type-caption text-slate-400 truncate min-w-0">
            {user?.email ?? 'Signed in'}
          </span>
        )}
        <button
          onClick={onSignOut}
          className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-zinc-800 transition shrink-0"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  )
}
