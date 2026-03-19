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
    <svg className="h-4 w-4 animate-spin text-muted" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function PlaybookDrawerComponent({ open, onClose, position, playbook, loading, error }: PlaybookDrawerProps) {
  const hasPlaybook = Boolean(playbook)
  const links = playbook?.links ?? []
  const signals = playbook?.signals ?? []
  const hasLinks = links.length > 0
  const hasSignals = signals.length > 0
  const drawerRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const drawer = drawerRef.current
      if (!drawer) return
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handler)

    // Move focus into the drawer on open
    const drawer = drawerRef.current
    const firstFocusable = drawer?.querySelector<HTMLElement>(FOCUSABLE_SELECTORS)
    firstFocusable?.focus()

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
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />
      <aside ref={drawerRef} className="relative h-full w-full max-w-xl overflow-y-auto border-l border-border-default bg-surface-card">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border-default bg-surface-card px-4 py-3">
          <div>
            <div className="type-caption font-semibold uppercase tracking-[0.2em] text-subtle">Program Playbook</div>
            <div className="type-title-m font-semibold text-strong">{safeTitle}</div>
            <div className="type-subhead text-muted">{position.structureId ? <>Structure {position.structureId}</> : position.underlying}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-full border border-border-strong bg-surface-chip p-2 text-subtle shadow-sm hover:bg-surface-hover"
          >
            <CloseIcon className="h-4 w-4" />
            <span className="sr-only">Close playbook drawer</span>
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-chip px-3 py-2 type-subhead text-subtle">
              <InlineSpinner />
              <span>Loading program resources…</span>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border banner-danger px-3 py-2 type-subhead">{error}</div>
          ) : null}

          {hasPlaybook ? (
            <article className="rounded-xl border border-border-default bg-surface-chip p-4 shadow-sm">
              <table className="mt-3 w-full table-fixed border-separate border-spacing-y-2 type-subhead text-body">
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
                          className="align-top text-left type-caption font-semibold uppercase tracking-[0.12em] text-muted"
                        >
                          {item.label}
                        </th>
                        <td className="align-top whitespace-pre-line leading-relaxed text-strong">{item.value}</td>
                      </tr>
                    ))}
                </tbody>
              </table>

              {playbook?.otherNotes ? (
                <div className="mt-3 rounded-lg border border-border-default bg-surface-card p-3 type-subhead text-body whitespace-pre-line">
                  {playbook.otherNotes}
                </div>
              ) : null}

              {hasSignals ? (
                <div className="mt-4 rounded-lg border playbook-panel p-3 type-subhead text-strong shadow-sm">
                  <div className="flex items-center gap-2 type-caption font-semibold uppercase tracking-[0.15em] text-playbook-text">
                    <SparklesIcon className="h-4 w-4" />
                    Market Signals
                  </div>
                  <ul className="mt-2 space-y-2">
                    {signals.map((signal) => (
                      <li key={signal.id} className="rounded border border-border-default bg-surface-chip px-3 py-2">
                        <div className="type-subhead font-semibold text-strong">{signal.label}</div>
                        {signal.trigger ? (
                          <div className="mt-1 type-caption text-body">
                            <span className="font-semibold text-subtle">Trigger:</span> {signal.trigger}
                          </div>
                        ) : null}
                        {signal.action ? (
                          <div className="mt-1 type-caption text-body">
                            <span className="font-semibold text-subtle">Action:</span> {signal.action}
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
            <div className="rounded-lg border border-border-default bg-surface-chip px-3 py-2 type-subhead text-body">
              No program playbook found for this structure.
            </div>
          ) : null}

          {hasLinks ? (
            <div className="rounded-lg border border-border-default bg-surface-card p-4 type-subhead text-strong shadow-sm">
              <div className="type-caption font-semibold uppercase tracking-[0.2em] text-muted">Helpful Links</div>
              <ul className="mt-3 space-y-2">
                {links.map((link) => {
                  const linkLabel = link.title && link.title !== safeTitle ? link.title : 'Resource'

                  return (
                    <li
                      key={link.id}
                      className="flex items-start justify-between gap-3 rounded border border-border-default bg-surface-chip px-3 py-2"
                    >
                      <div>
                        <div className="type-subhead font-semibold text-strong">{linkLabel}</div>
                        {link.notes ? (
                          <div className="type-caption text-subtle whitespace-pre-line">{link.notes}</div>
                        ) : null}
                      </div>
                    {link.url ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface-chip px-3 py-1 type-caption font-semibold text-body shadow-sm transition hover:bg-surface-hover"
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
            <div className="rounded-lg border playbook-panel px-4 py-3 type-subhead text-strong">
              <div className="type-caption font-semibold uppercase tracking-[0.2em] text-playbook-text">Playbook notes</div>
              <div className="mt-2 whitespace-pre-line leading-relaxed">{position.playbook}</div>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

export const PlaybookDrawer = React.memo(
  PlaybookDrawerComponent,
  (prev, next) =>
    prev.open === next.open &&
    prev.onClose === next.onClose &&
    prev.loading === next.loading &&
    prev.error === next.error &&
    prev.position === next.position &&
    prev.playbook === next.playbook,
)

PlaybookDrawer.displayName = 'PlaybookDrawer'
