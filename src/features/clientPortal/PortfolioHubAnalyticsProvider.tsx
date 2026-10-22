import React from 'react'
import { usePortfolioHubAnalytics } from './usePortfolioHubAnalytics'

const AnalyticsContext = React.createContext<ReturnType<typeof usePortfolioHubAnalytics> | null>(null)

/** Lives outside snapshot/lifetime success branches; cards consume this in Package 4. */
export function PortfolioHubAnalyticsProvider({ children, enabled, accountIdHint }: {
  children: React.ReactNode
  enabled: boolean
  accountIdHint?: string
}) {
  return enabled ? <MountedAnalyticsProvider accountIdHint={accountIdHint}>{children}</MountedAnalyticsProvider> : <>{children}</>
}

function MountedAnalyticsProvider({ children, accountIdHint }: { children: React.ReactNode; accountIdHint?: string }) {
  const analytics = usePortfolioHubAnalytics({ accountIdHint })
  return <AnalyticsContext.Provider value={analytics}>{children}</AnalyticsContext.Provider>
}

export function useDashboardAnalytics() {
  const context = React.useContext(AnalyticsContext)
  if (!context) throw new Error('Dashboard analytics requires PortfolioHubAnalyticsProvider')
  return context
}
