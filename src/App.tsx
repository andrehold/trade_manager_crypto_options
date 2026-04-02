import React from 'react'
import DashboardApp, { type InnerView } from './DashboardApp'

type ViewState =
  | { type: 'dashboard' }
  | { type: 'clientDashboard' }
  | { type: 'addClient' }
  | { type: 'playbookIndex' }
  | { type: 'playbookDetail'; slug: string }
  | { type: 'assignLegs' }
  | { type: 'mapCSV' }
  | { type: 'structureDetail'; id: string }

function parseHash(hash: string | undefined | null): ViewState {
  if (!hash) return { type: 'dashboard' }
  const normalized = hash.replace(/^#/, '')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) return { type: 'dashboard' }
  if (segments[0] === 'client-dashboard') return { type: 'clientDashboard' }
  if (segments[0] === 'add-client') return { type: 'addClient' }
  if (segments[0] === 'assign-legs') return { type: 'assignLegs' }
  if (segments[0] === 'map-csv') return { type: 'mapCSV' }
  if (segments[0] === 'structure' && segments.length >= 2) return { type: 'structureDetail', id: decodeURIComponent(segments[1]) }
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

  const goPlaybookIndex = React.useCallback(() => navigate('#/playbooks'), [navigate])
  const goPlaybook = React.useCallback((slug: string) => navigate(`#/playbooks/${slug}`), [navigate])
  const goAssignLegs = React.useCallback(() => navigate('#/assign-legs'), [navigate])
  const goMapCSV = React.useCallback(() => navigate('#/map-csv'), [navigate])
  const goStructureDetail = React.useCallback((id: string) => navigate(`#/structure/${encodeURIComponent(id)}`), [navigate])
  const goClientDashboard = React.useCallback(() => navigate('#/client-dashboard'), [navigate])
  const goAddClient = React.useCallback(() => navigate('#/add-client'), [navigate])
  const goDashboard = React.useCallback(() => { window.location.hash = '' }, [])

  const innerView: InnerView | undefined =
    view.type === 'mapCSV' ? 'mapCSV' :
    view.type === 'assignLegs' ? 'assignLegs' :
    view.type === 'playbookIndex' ? 'playbookIndex' :
    view.type === 'clientDashboard' ? 'clientDashboard' :
    view.type === 'addClient' ? 'addClient' :
    view.type === 'playbookDetail' ? { type: 'playbookDetail', slug: view.slug } :
    view.type === 'structureDetail' ? { type: 'structureDetail', id: view.id } :
    undefined

  return (
    <DashboardApp
      innerView={innerView}
      onOpenPlaybookIndex={goPlaybookIndex}
      onOpenPlaybook={goPlaybook}
      onOpenAssignLegs={goAssignLegs}
      onOpenMapCSV={goMapCSV}
      onOpenStructureDetail={goStructureDetail}
      onNavigateClientDashboard={goClientDashboard}
      onNavigateAddClient={goAddClient}
      onNavigateDashboard={goDashboard}
    />
  )
}
