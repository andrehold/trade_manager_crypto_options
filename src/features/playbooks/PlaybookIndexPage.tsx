import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { listPlaybooks } from './playbooks'

type PlaybookIndexPageProps = {
  onBack: () => void
  onSelectPlaybook: (slug: string) => void
  embedded?: boolean
}

export function PlaybookIndexPage({ onBack, onSelectPlaybook, embedded }: PlaybookIndexPageProps) {
  const playbooks = React.useMemo(() => listPlaybooks(), [])

  return (
    <div className={embedded ? 'flex-1 min-h-0 flex flex-col bg-layer-page text-zinc-100' : 'min-h-screen bg-layer-page text-zinc-100'}>
      <header className="px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {!embedded && (
            <div>
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1.5 type-subhead text-zinc-200 hover:bg-zinc-800"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to dashboard
              </button>
            </div>
          )}
          <div>
            <p className="type-caption uppercase tracking-[0.3em] text-indigo-300">Strategy Library</p>
            {!embedded && <h1 className="mt-3 type-display-l font-semibold tracking-tight text-white">Strategy Playbooks</h1>}
            <p className={`${embedded ? 'mt-1' : 'mt-4'} max-w-3xl type-title-m text-zinc-300`}>
              Reusable frameworks that codify how we trade crypto options across common market regimes. Pick one to drill into
              structure selection, key KPIs, and risk controls.
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 pb-16 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          {playbooks.map((playbook) => (
            <button
              key={playbook.slug}
              onClick={() => onSelectPlaybook(playbook.slug)}
              className="group flex h-full flex-col rounded-xl border border-zinc-800 bg-layer-card p-6 text-left shadow-xl transition hover:border-indigo-500/50 hover:bg-layer-chip"
            >
              <div className="type-caption uppercase tracking-[0.3em] text-indigo-300">{playbook.slug}</div>
              <h2 className="mt-2 type-title-l font-semibold text-white group-hover:text-indigo-100">{playbook.name}</h2>
              {playbook.tagline ? (
                <p className="mt-3 type-subhead text-zinc-300">{playbook.tagline}</p>
              ) : null}
              <p className="mt-4 type-subhead text-zinc-400">{playbook.description}</p>
              {playbook.lastUpdated ? (
                <div className="mt-5 type-caption text-zinc-500">Updated {playbook.lastUpdated}</div>
              ) : null}
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}
