import React from 'react'
import { Link as LinkIcon, X as CloseIcon } from 'lucide-react'
import type { Position } from '../utils'
import type { ProgramResource } from '../lib/positions'

type PlaybookDrawerProps = {
  open: boolean
  onClose: () => void
  position: Position | null
  resources: ProgramResource[]
  loading?: boolean
  error?: string | null
}

function InlineSpinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-slate-600" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

export function PlaybookDrawer({ open, onClose, position, resources, loading, error }: PlaybookDrawerProps) {
  const hasResources = resources.length > 0

  React.useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open || !position) return null

  const safeProgramName = position.programName || 'Program playbook'

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <button
        type="button"
        aria-label="Close playbook drawer"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <aside
        className="relative h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white shadow-[-32px_0_72px_-18px_rgba(15,23,42,0.35)] before:pointer-events-none before:absolute before:left-0 before:top-0 before:h-full before:w-6 before:bg-gradient-to-l before:from-slate-900/15 before:to-transparent"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Program Playbook</div>
            <div className="text-lg font-semibold text-slate-900">{safeProgramName}</div>
            <div className="text-sm text-slate-500">{position.structureId ? <>Structure {position.structureId}</> : position.underlying}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-100"
          >
            <CloseIcon className="h-4 w-4" />
            <span className="sr-only">Close playbook drawer</span>
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <InlineSpinner />
              <span>Loading program resources…</span>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          ) : null}

          {hasResources
            ? resources.map((resource) => (
                <article key={resource.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{resource.title}</div>
                      {position.programName ? (
                        <div className="text-xs text-slate-500">{position.programName}</div>
                      ) : null}
                    </div>
                    {resource.playbookUrl ? (
                      <a
                        href={resource.playbookUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                      >
                        <LinkIcon className="h-3.5 w-3.5" />
                        <span>Open</span>
                      </a>
                    ) : null}
                  </div>

                  <dl className="mt-3 space-y-2 text-sm text-slate-700">
                    {resource.profitRule ? (
                      <div className="flex gap-2">
                        <dt className="w-16 shrink-0 text-xs uppercase tracking-wide text-slate-500">Profit</dt>
                        <dd className="flex-1 leading-relaxed">{resource.profitRule}</dd>
                      </div>
                    ) : null}
                    {resource.stopRule ? (
                      <div className="flex gap-2">
                        <dt className="w-16 shrink-0 text-xs uppercase tracking-wide text-slate-500">Stop</dt>
                        <dd className="flex-1 leading-relaxed">{resource.stopRule}</dd>
                      </div>
                    ) : null}
                    {resource.timeRule ? (
                      <div className="flex gap-2">
                        <dt className="w-16 shrink-0 text-xs uppercase tracking-wide text-slate-500">Time</dt>
                        <dd className="flex-1 leading-relaxed">{resource.timeRule}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {resource.riskNotes ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 whitespace-pre-line">
                      {resource.riskNotes}
                    </div>
                  ) : null}
                </article>
              ))
            : null}

          {!loading && !hasResources ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No program playbook resources found for this structure.
            </div>
          ) : null}

          {position.playbook ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-slate-800">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-700">Playbook notes</div>
              <div className="mt-2 whitespace-pre-line leading-relaxed">{position.playbook}</div>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
