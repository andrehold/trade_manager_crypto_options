import React from 'react'
import { Link as LinkIcon, Sparkles as SparklesIcon, X as CloseIcon } from 'lucide-react'
import type { Position } from '../utils'
import type { ProgramPlaybook } from '../lib/positions'

type PlaybookDrawerProps = {
  open: boolean
  onClose: () => void
  position: Position | null
  playbook: ProgramPlaybook | null
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

export function PlaybookDrawer({ open, onClose, position, playbook, loading, error }: PlaybookDrawerProps) {
  const hasPlaybook = Boolean(playbook)
  const links = playbook?.links ?? []
  const signals = playbook?.signals ?? []
  const hasLinks = links.length > 0
  const hasSignals = signals.length > 0

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
  const safeTitle = safeProgramName

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <button
        type="button"
        aria-label="Close playbook drawer"
        className="absolute inset-0 transition-opacity"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Program Playbook</div>
            <div className="text-lg font-semibold text-slate-900">{safeTitle}</div>
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

          {hasPlaybook ? (
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
              <table className="mt-3 w-full table-fixed border-separate border-spacing-y-2 text-sm text-slate-700">
                <colgroup>
                  <col className="w-1/3" />
                  <col className="w-2/3" />
                </colgroup>
                <tbody className="align-top">
                  {[
                    { label: 'Profit', value: playbook?.profitRule },
                    { label: 'Stop', value: playbook?.stopRule },
                    { label: 'Time', value: playbook?.timeRule },
                  ]
                    .filter((item) => Boolean(item.value))
                    .map((item) => (
                      <tr key={item.label}>
                        <th
                          scope="row"
                          className="align-top text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
                        >
                          {item.label}
                        </th>
                        <td className="align-top whitespace-pre-line leading-relaxed text-slate-800">{item.value}</td>
                      </tr>
                    ))}
                </tbody>
              </table>

              {playbook?.otherNotes ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 whitespace-pre-line">
                  {playbook.otherNotes}
                </div>
              ) : null}

              {hasSignals ? (
                <div className="mt-4 rounded-lg border border-indigo-100 bg-white p-3 text-sm text-slate-800 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-indigo-700">
                    <SparklesIcon className="h-4 w-4" />
                    Market Signals
                  </div>
                  <ul className="mt-2 space-y-2">
                    {signals.map((signal) => (
                      <li key={signal.id} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-sm font-semibold text-slate-900">{signal.label}</div>
                        {signal.trigger ? (
                          <div className="mt-1 text-xs text-slate-700">
                            <span className="font-semibold text-slate-600">Trigger:</span> {signal.trigger}
                          </div>
                        ) : null}
                        {signal.action ? (
                          <div className="mt-1 text-xs text-slate-700">
                            <span className="font-semibold text-slate-600">Action:</span> {signal.action}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ) : null}

          {!loading && !hasPlaybook ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No program playbook found for this structure.
            </div>
          ) : null}

          {hasLinks ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-800 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Helpful Links</div>
              <ul className="mt-3 space-y-2">
                {links.map((link) => {
                  const linkLabel = link.title && link.title !== safeTitle ? link.title : 'Resource'

                  return (
                    <li
                      key={link.id}
                      className="flex items-start justify-between gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{linkLabel}</div>
                        {link.notes ? (
                          <div className="text-xs text-slate-600 whitespace-pre-line">{link.notes}</div>
                        ) : null}
                      </div>
                    {link.url ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                      >
                        <LinkIcon className="h-3.5 w-3.5" />
                        <span>Open</span>
                      </a>
                    ) : null}
                    </li>
                  )
                })}
              </ul>
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
