import React from 'react'
import { getPlaybook, listPlaybooks } from './playbooks'

type StrategyPlaybookPageProps = {
  slug: string
  onBackToIndex: () => void
  onBackToDashboard: () => void
  onOpenPlaybook: (slug: string) => void
}

export function StrategyPlaybookPage({
  slug,
  onBackToIndex,
  onBackToDashboard,
  onOpenPlaybook,
}: StrategyPlaybookPageProps) {
  const playbook = getPlaybook(slug)
  const others = React.useMemo(() => listPlaybooks().filter((item) => item.slug !== slug), [slug])

  if (!playbook) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
          <button
            type="button"
            onClick={onBackToDashboard}
            className="w-fit rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900"
          >
            ← Back to dashboard
          </button>
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Playbook not found</h1>
            <p className="mt-4 text-slate-300">
              We could not find the requested strategy playbook. Choose another strategy from the catalogue.
            </p>
            <button
              type="button"
              onClick={onBackToIndex}
              className="mt-6 inline-flex items-center justify-center rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-sky-400"
            >
              Browse playbooks
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_55%)]" />

      <header className="px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <button
              type="button"
              onClick={onBackToDashboard}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1.5 hover:bg-slate-900"
            >
              ← Dashboard
            </button>
            <button
              type="button"
              onClick={onBackToIndex}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1.5 hover:bg-slate-900"
            >
              Browse Playbooks
            </button>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-sky-300">Strategy Playbook</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              {playbook.name}
            </h1>
            {playbook.tagline ? (
              <p className="mt-4 max-w-3xl text-lg text-slate-300">{playbook.tagline}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
            {playbook.lastUpdated ? (
              <span className="rounded-full border border-slate-700 px-3 py-1">Updated {playbook.lastUpdated}</span>
            ) : null}
            <span className="rounded-full border border-slate-700 px-3 py-1 text-slate-300">
              {playbook.description}
            </span>
          </div>
        </div>
      </header>

      <main className="px-6 pb-16">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[3fr_1.2fr]">
          <article className="space-y-8">
            {playbook.sections.map((section) => (
              <section key={section.title} className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
                <h2 className="text-2xl font-semibold text-white">{section.title}</h2>
                {section.intro ? <p className="mt-3 text-sm text-slate-300">{section.intro}</p> : null}
                {section.paragraphs?.map((paragraph, idx) => (
                  <p key={idx} className="mt-4 text-base leading-relaxed text-slate-200">
                    {paragraph}
                  </p>
                ))}
                {section.lists?.map((list) => (
                  <div key={list.title ?? list.items[0]} className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                    {list.title ? (
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{list.title}</h3>
                    ) : null}
                    <ul className="mt-3 space-y-2 text-sm text-slate-200">
                      {list.items.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </article>

          <aside className="flex flex-col gap-6">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
              <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">Execution Checklist</h2>
              <p className="mt-3 text-sm text-slate-300">
                Snapshot the plan before you stage orders. Confirm IV context, liquidity, and catalysts before sizing.
              </p>
              <ul className="mt-4 space-y-3 text-sm text-slate-200">
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                  <span>Validate short-dated IV premium versus weekly tenor.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                  <span>Map key strikes &amp; funding to gauge directional bias.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                  <span>Plan defined-risk exits for gap scenarios before the weekend.</span>
                </li>
              </ul>
            </div>

            {others.length ? (
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">Other Playbooks</h2>
                <p className="mt-3 text-sm text-slate-300">Explore more strategies built on the same framework.</p>
                <ul className="mt-4 space-y-3 text-sm text-slate-200">
                  {others.map((item) => (
                    <li key={item.slug}>
                      <button
                        type="button"
                        onClick={() => onOpenPlaybook(item.slug)}
                        className="text-left text-sky-300 hover:text-sky-200"
                      >
                        {item.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
              <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">Need to tweak it?</h2>
              <p className="mt-3 text-sm text-slate-300">
                Document any adjustments directly in the playbook field inside the positions table so teammates see the latest
                nuance.
              </p>
              <button
                type="button"
                onClick={onBackToDashboard}
                className="mt-4 inline-flex items-center justify-center rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-400"
              >
                Back to positions
              </button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
