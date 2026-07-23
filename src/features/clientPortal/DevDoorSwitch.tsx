import type { Door } from './routing'

export function DevDoorSwitch({ role }: { role: Door }) {
  if (!import.meta.env.DEV) return null
  const go = (r: Door) => { window.location.hash = r === 'admin' ? '#/admin' : '#/login' }
  return (
    <div className="fixed bottom-4 left-4 z-[90] flex items-center gap-2 rounded-xl border border-dashed border-border-default bg-bg-surface-1/90 px-3 py-1.5 font-mono text-[11px] shadow-lg backdrop-blur">
      <span className="uppercase tracking-wider text-text-tertiary">Dev</span>
      <div className="flex gap-1 rounded-lg bg-bg-surface-2 p-0.5">
        <button type="button" onClick={() => go('client')} className={`rounded-md px-2.5 py-1 font-semibold ${role === 'client' ? 'bg-accent-500/15 text-accent-400' : 'text-text-tertiary'}`}>Client</button>
        <button type="button" onClick={() => go('admin')} className={`rounded-md px-2.5 py-1 font-semibold ${role === 'admin' ? 'bg-status-warning/15 text-status-warning' : 'text-text-tertiary'}`}>Admin</button>
      </div>
    </div>
  )
}
