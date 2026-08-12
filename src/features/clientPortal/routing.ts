export type PortalPage =
  | 'dashboard' | 'positions' | 'appropriateness' | 'strategy'
  | 'ledger' | 'risk' | 'keys' | 'updates' | 'audit'

export type Door = 'client' | 'admin'

const PORTAL_PAGES: PortalPage[] = [
  'dashboard', 'positions', 'ledger', 'appropriateness', 'strategy',
  'risk', 'keys', 'updates', 'audit',
]

function segments(hash: string): string[] {
  return (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean)
}

export function parseDoor(hash: string): Door {
  return segments(hash)[0] === 'admin' ? 'admin' : 'client'
}

export function isPortalRoute(hash: string): boolean {
  return segments(hash)[0] === 'portal'
}

export function parsePortalPage(hash: string): PortalPage {
  const page = segments(hash)[1] as PortalPage | undefined
  return page && PORTAL_PAGES.includes(page) ? page : 'dashboard'
}

export function portalHash(page: PortalPage): string {
  return `#/portal/${page}`
}
