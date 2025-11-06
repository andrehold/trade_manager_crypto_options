import React from 'react'
import DashboardApp from './DashboardApp'
import { PlaybookIndexPage } from './features/playbooks/PlaybookIndexPage'
import { StrategyPlaybookPage } from './features/playbooks/StrategyPlaybookPage'

type ViewState =
  | { type: 'dashboard' }
  | { type: 'playbookIndex' }
  | { type: 'playbookDetail'; slug: string }

function parseHash(hash: string | undefined | null): ViewState {
  if (!hash) return { type: 'dashboard' }
  const normalized = hash.replace(/^#/, '')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) return { type: 'dashboard' }
  if (segments[0] !== 'playbooks') return { type: 'dashboard' }
  if (segments.length === 1) return { type: 'playbookIndex' }
  return { type: 'playbookDetail', slug: segments[1] }
}

function useHashView(): ViewState {
  const [view, setView] = React.useState<ViewState>(() =>
    typeof window !== 'undefined' ? parseHash(window.location.hash) : { type: 'dashboard' },
  )

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setView(parseHash(window.location.hash))
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  return view
}

function useHashNavigation() {
  return React.useCallback((hash: string) => {
    if (typeof window === 'undefined') return
    window.location.hash = hash
  }, [])
}

export default function App() {
  const view = useHashView()
  const navigate = useHashNavigation()

  const goDashboard = React.useCallback(() => navigate(''), [navigate])
  const goPlaybookIndex = React.useCallback(() => navigate('#/playbooks'), [navigate])
  const goPlaybook = React.useCallback((slug: string) => navigate(`#/playbooks/${slug}`), [navigate])

  if (view.type === 'playbookIndex') {
    return <PlaybookIndexPage onBack={goDashboard} onSelectPlaybook={goPlaybook} />
  }

  if (view.type === 'playbookDetail') {
    return (
      <StrategyPlaybookPage
        slug={view.slug}
        onBackToIndex={goPlaybookIndex}
        onBackToDashboard={goDashboard}
        onOpenPlaybook={goPlaybook}
      />
    )
  }

  return <DashboardApp onOpenPlaybookIndex={goPlaybookIndex} />
}
