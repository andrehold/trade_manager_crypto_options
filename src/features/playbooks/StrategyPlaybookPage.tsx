import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { getPlaybook, listPlaybooks } from './playbooks'
import { Button, Card } from '../../components/ui'

type StrategyPlaybookPageProps = {
  slug: string
  onBackToIndex: () => void
  onBackToDashboard: () => void
  onOpenPlaybook: (slug: string) => void
  embedded?: boolean
}

export function StrategyPlaybookPage({
  slug,
  onBackToIndex,
  onBackToDashboard,
  onOpenPlaybook,
  embedded,
}: StrategyPlaybookPageProps) {
  const playbook = getPlaybook(slug)
  const others = React.useMemo(() => listPlaybooks().filter((item) => item.slug !== slug), [slug])

  if (!playbook) {
    return (
      <div className={embedded ? 'flex-1 min-h-0 flex flex-col bg-bg-canvas text-text-primary' : 'min-h-screen bg-bg-canvas text-text-primary'}>
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
          {!embedded && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              onClick={onBackToDashboard}
              className="w-fit"
            >
              Back to dashboard
            </Button>
          )}
          <Card variant="panel">
            <h1 className="type-display-l font-semibold tracking-tight text-text-primary">Playbook not found</h1>
            <p className="mt-4 text-text-secondary">
              We could not find the requested strategy playbook. Choose another strategy from the catalogue.
            </p>
            <Button
              variant="primary"
              onClick={onBackToIndex}
              className="mt-6"
            >
              Browse playbooks
            </Button>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className={embedded ? 'flex-1 min-h-0 flex flex-col bg-bg-canvas text-text-primary' : 'min-h-screen bg-bg-canvas text-text-primary'}>
      <header className="px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {!embedded && (
            <div className="flex flex-wrap items-center gap-3 type-subhead text-text-secondary">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<ArrowLeft className="h-4 w-4" />}
                onClick={onBackToDashboard}
              >
                Dashboard
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onBackToIndex}
              >
                Browse Playbooks
              </Button>
            </div>
          )}

          <div>
            <p className="type-caption uppercase tracking-[0.3em] text-accent-400">Strategy Playbook</p>
            <h1 className="mt-3 type-display-l font-semibold tracking-tight text-text-primary">
              {playbook.name}
            </h1>
            {playbook.tagline ? (
              <p className="mt-4 max-w-3xl type-title-m text-text-secondary">{playbook.tagline}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-4 type-subhead text-text-tertiary">
            {playbook.lastUpdated ? (
              <span className="rounded-full border border-border-strong px-3 py-1">Updated {playbook.lastUpdated}</span>
            ) : null}
            <span className="rounded-full border border-border-strong px-3 py-1 text-text-secondary">
              {playbook.description}
            </span>
          </div>
        </div>
      </header>

      <main className="px-6 pb-16 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[3fr_1.2fr]">
          <article className="space-y-8">
            {playbook.sections.map((section) => (
              <Card key={section.title} variant="panel">
                <h2 className="type-title-l font-semibold text-text-primary">{section.title}</h2>
                {section.intro ? <p className="mt-3 type-subhead text-text-secondary">{section.intro}</p> : null}
                {section.paragraphs?.map((paragraph, idx) => (
                  <p key={idx} className="mt-4 type-headline leading-relaxed text-text-primary">
                    {paragraph}
                  </p>
                ))}
                {section.lists?.map((list) => (
                  <div key={list.title ?? list.items[0]} className="mt-5 rounded-xl border border-border-default bg-bg-surface-3 p-4">
                    {list.title ? (
                      <h3 className="type-subhead font-semibold uppercase tracking-wide text-text-secondary">{list.title}</h3>
                    ) : null}
                    <ul className="mt-3 space-y-2 type-subhead text-text-primary">
                      {list.items.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </Card>
            ))}
          </article>

          <aside className="flex flex-col gap-6">
            <Card variant="panel">
              <h2 className="type-subhead font-semibold uppercase tracking-[0.3em] text-text-secondary">Execution Checklist</h2>
              <p className="mt-3 type-subhead text-text-secondary">
                Snapshot the plan before you stage orders. Confirm IV context, liquidity, and catalysts before sizing.
              </p>
              <ul className="mt-4 space-y-3 type-subhead text-text-primary">
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-status-success" />
                  <span>Validate short-dated IV premium versus weekly tenor.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-status-success" />
                  <span>Map key strikes &amp; funding to gauge directional bias.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-status-success" />
                  <span>Plan defined-risk exits for gap scenarios before the weekend.</span>
                </li>
              </ul>
            </Card>

            {others.length ? (
              <Card variant="panel">
                <h2 className="type-subhead font-semibold uppercase tracking-[0.3em] text-text-secondary">Other Playbooks</h2>
                <p className="mt-3 type-subhead text-text-secondary">Explore more strategies built on the same framework.</p>
                <ul className="mt-4 space-y-3 type-subhead text-text-primary">
                  {others.map((item) => (
                    <li key={item.slug}>
                      <button
                        type="button"
                        onClick={() => onOpenPlaybook(item.slug)}
                        className="text-left text-accent-400 hover:text-accent-300"
                      >
                        {item.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card variant="panel">
              <h2 className="type-subhead font-semibold uppercase tracking-[0.3em] text-text-secondary">Need to tweak it?</h2>
              <p className="mt-3 type-subhead text-text-secondary">
                Document any adjustments directly in the playbook field inside the positions table so teammates see the latest
                nuance.
              </p>
              <Button
                variant="primary"
                onClick={onBackToDashboard}
                className="mt-4"
              >
                Back to positions
              </Button>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  )
}
