import { Shield } from 'lucide-react'

export function ResponsibilityStrip({ onOpenAudit }: { onOpenAudit: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-2 bg-accent-500/15 border-b border-accent-500/40 text-accent-400" role="note">
      <Shield className="h-4 w-4 shrink-0" />
      <span className="type-caption text-text-secondary flex-1 min-w-0">
        You retain full responsibility for <strong className="text-text-primary">regulatory compliance</strong> and all{' '}
        <strong className="text-text-primary">investment decisions</strong>. This software executes only the parameters you set — it provides no advice or recommendation.
      </span>
      <button type="button" onClick={onOpenAudit} className="type-caption font-semibold text-accent-400 hover:underline whitespace-nowrap">
        View attestations &amp; audit log <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}
