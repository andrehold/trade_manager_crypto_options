import React from 'react'
import { listPlaybooks } from './playbooks'

type PlaybookIndexPageProps = {
  onBack: () => void
  onSelectPlaybook: (slug: string) => void
}

export function PlaybookIndexPage({ onBack, onSelectPlaybook }: PlaybookIndexPageProps) {
  const playbooks = React.useMemo(() => listPlaybooks(), [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_55%)]" />

      <header className="px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <div>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-900"
            >
              ← Back to dashboard
            </button>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-indigo-300">Strategy Library</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Strategy Playbooks</h1>
            <p className="mt-4 max-w-3xl text-lg text-slate-300">
              Reusable frameworks that codify how we trade crypto options across common market regimes. Pick one to drill into
              structure selection, key KPIs, and risk controls.
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 pb-16">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          {playbooks.map((playbook) => (
            <button
              key={playbook.slug}
              onClick={() => onSelectPlaybook(playbook.slug)}
              className="group flex h-full flex-col rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-left shadow-xl transition hover:border-indigo-400/60 hover:bg-slate-900"
            >
              <div className="text-xs uppercase tracking-[0.3em] text-indigo-300">{playbook.slug}</div>
              <h2 className="mt-2 text-2xl font-semibold text-white group-hover:text-indigo-100">{playbook.name}</h2>
              {playbook.tagline ? (
                <p className="mt-3 text-sm text-slate-300">{playbook.tagline}</p>
              ) : null}
              <p className="mt-4 text-sm text-slate-400">{playbook.description}</p>
              {playbook.lastUpdated ? (
                <div className="mt-5 text-xs text-slate-500">Updated {playbook.lastUpdated}</div>
              ) : null}
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}
