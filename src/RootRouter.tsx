import React from 'react'
import App from '@/App'
import { useAuth } from '@/features/auth/useAuth'
import { resolveClientAccess } from '@/features/auth/access'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { Spinner } from '@/components/Spinner'
import { LoginDoor } from '@/features/clientPortal/LoginDoor'
import { DevDoorSwitch } from '@/features/clientPortal/DevDoorSwitch'
import { ClientPortalShell } from '@/features/clientPortal/ClientPortalShell'
import { parseDoor } from '@/features/clientPortal/routing'

function useHash(): string {
  const [hash, setHash] = React.useState(() => (typeof window !== 'undefined' ? window.location.hash : ''))
  React.useEffect(() => {
    const handler = () => setHash(window.location.hash)
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  return hash
}

export function RootRouter() {
  const hash = useHash()
  const { user, loading } = useAuth()
  const { isAdmin, clientName } = resolveClientAccess(user)
  const door = parseDoor(hash)

  const signOut = React.useCallback(() => {
    if (hasSupabaseClient()) void getSupabaseClient().auth.signOut()
    window.location.hash = '#/login'
  }, [])

  let content: React.ReactNode
  if (loading) {
    content = <div className="grid min-h-screen place-items-center bg-bg-canvas"><Spinner className="h-6 w-6" /></div>
  } else if (!user) {
    // Unauthenticated: admin door falls through to the existing admin app (which shows its own login);
    // every other entry (client door, or a #/portal/* deep link) shows the branded client login.
    content = door === 'admin' ? <App /> : <LoginDoor role="client" />
  } else if (!isAdmin) {
    content = <ClientPortalShell clientName={clientName ?? 'Client'} program="Obsidian Core" hash={hash} onSignOut={signOut} />
  } else {
    content = <App />
  }

  return <>{content}<DevDoorSwitch role={door} /></>
}
