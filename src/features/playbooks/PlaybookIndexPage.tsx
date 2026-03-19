import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { listPlaybooks } from './playbooks'
import { Button, Card } from '../../components/ui'

type PlaybookIndexPageProps = {
  onBack: () => void
  onSelectPlaybook: (slug: string) => void
  embedded?: boolean
}

export function PlaybookIndexPage({ onBack, onSelectPlaybook, embedded }: PlaybookIndexPageProps) {
  const playbooks = React.useMemo(() => listPlaybooks(), [])

  return (
    <div className={embedded ? 'flex-1 min-h-0 flex flex-col bg-bg-canvas text-text-primary' : 'min-h-screen bg-bg-canvas text-text-primary'}>
      <header className="px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {!embedded && (
            <div>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<ArrowLeft className="h-4 w-4" />}
                onClick={onBack}
              >
                Back to dashboard
              </Button>
            </div>
          )}
          <div>
            <p className="type-caption uppercase tracking-[0.3em] text-accent-400">Strategy Library</p>
            {!embedded && <h1 className="mt-3 type-display-l font-semibold tracking-tight text-text-primary">Strategy Playbooks</h1>}
            <p className={`${embedded ? 'mt-1' : 'mt-4'} max-w-3xl type-title-m text-text-secondary`}>
              Reusable frameworks that codify how we trade crypto options across common market regimes. Pick one to drill into
              structure selection, key KPIs, and risk controls.
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 pb-16 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          {playbooks.map((playbook) => (
            <Card
              key={playbook.slug}
              variant="interactive"
              className="h-full text-left cursor-pointer"
            >
              <button
                onClick={() => onSelectPlaybook(playbook.slug)}
                className="flex h-full w-full flex-col text-left"
              >
                <div className="type-caption uppercase tracking-[0.3em] text-accent-400">{playbook.slug}</div>
                <h2 className="mt-2 type-title-l font-semibold text-text-primary">{playbook.name}</h2>
                {playbook.tagline ? (
                  <p className="mt-3 type-subhead text-text-secondary">{playbook.tagline}</p>
                ) : null}
                <p className="mt-4 type-subhead text-text-tertiary">{playbook.description}</p>
                {playbook.lastUpdated ? (
                  <div className="mt-5 type-caption text-text-tertiary">Updated {playbook.lastUpdated}</div>
                ) : null}
              </button>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}
