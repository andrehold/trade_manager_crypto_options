import { Play, Square } from 'lucide-react'
import { canActivate, outstandingItems, type SetupStatus } from './setupStatus'

export function ActivationControl({
  active, setupStatus, onToggle,
}: { active: boolean; setupStatus: SetupStatus; onToggle: () => void }) {
  const gateOpen = canActivate(setupStatus)
  const outstanding = outstandingItems(setupStatus)

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-1.5 ${active ? 'border-status-success/30 bg-status-success/10' : 'border-border-default bg-bg-surface-2'}`}>
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${active ? 'bg-status-success' : 'bg-text-tertiary'}`} />
        <span className="leading-tight">
          <span className="block type-caption uppercase tracking-wide text-text-tertiary">Software</span>
          <span className={`type-subhead font-semibold ${active ? 'text-status-success' : 'text-text-primary'}`}>
            {active ? 'Active' : 'Inactive'}
          </span>
        </span>
      </span>
      {active ? (
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 rounded-lg border border-status-danger/30 bg-status-danger/15 px-3 py-1.5 type-caption font-semibold text-status-danger hover:bg-status-danger/25"
        >
          <Square className="h-3.5 w-3.5" /> Deactivate
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          disabled={!gateOpen}
          title={gateOpen ? undefined : `Complete first: ${outstanding.join(', ')}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-status-success px-3 py-1.5 type-caption font-semibold text-white disabled:opacity-45 disabled:cursor-not-allowed"
        >
          <Play className="h-3.5 w-3.5" /> Activate
        </button>
      )}
    </div>
  )
}
