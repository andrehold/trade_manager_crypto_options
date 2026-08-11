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

type CanonicalClientProfile =
  | { status: 'ready'; clientId: string; clientName: string }
  | { status: 'fallback'; clientName: string }
  | { status: 'loading' }
  | { status: 'error'; clientId?: string; message: string }

function useCanonicalClientProfile(
  userId: string | undefined,
  isAdmin: boolean,
  clientId: string | null,
  legacyClientName: string | null,
): CanonicalClientProfile {
  const [profile, setProfile] = React.useState<CanonicalClientProfile>(() => ({
    status: 'fallback',
    clientName: legacyClientName ?? 'Client',
  }))

  const requiresCanonicalLookup = Boolean(userId && !isAdmin && hasSupabaseClient())

  React.useEffect(() => {
    if (!userId || isAdmin) {
      setProfile({ status: 'fallback', clientName: legacyClientName ?? 'Client' })
      return
    }

    // Local/demo builds without Supabase keep the existing metadata fallback.
    // A configured portal instead resolves the server-authoritative clients row.
    if (!hasSupabaseClient()) {
      setProfile({ status: 'fallback', clientName: legacyClientName ?? 'Client' })
      return
    }

    if (!clientId) {
      setProfile({
        status: 'error',
        message: 'Your portal account is not linked to a client profile. Please contact support.',
      })
      return
    }

    let cancelled = false
    setProfile({ status: 'loading' })

    void getSupabaseClient()
      .from('clients')
      .select('client_name')
      .eq('client_id', clientId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        const clientName = typeof data?.client_name === 'string' ? data.client_name.trim() : ''
        if (error || !clientName) {
          setProfile({
            status: 'error',
            clientId,
            message: 'Your portal client profile could not be loaded. Please contact support.',
          })
          return
        }
        setProfile({ status: 'ready', clientId, clientName })
      })

    return () => { cancelled = true }
  }, [clientId, isAdmin, legacyClientName, userId])

  // Effects run after paint. Do not render a legacy user_metadata name in the
  // interval before a configured portal resolves its canonical clients row.
  if (requiresCanonicalLookup) {
    if (!clientId) {
      return {
        status: 'error',
        message: 'Your portal account is not linked to a client profile. Please contact support.',
      }
    }
    if ((profile.status === 'ready' || profile.status === 'error') && profile.clientId === clientId) {
      return profile
    }
    return { status: 'loading' }
  }

  return profile.status === 'fallback'
    ? profile
    : { status: 'fallback', clientName: legacyClientName ?? 'Client' }
}

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
  const { isAdmin, clientName: legacyClientName, clientId } = resolveClientAccess(user)
  const canonicalClientProfile = useCanonicalClientProfile(user?.id, isAdmin, clientId, legacyClientName)
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
    if (canonicalClientProfile.status === 'loading') {
      content = <div className="grid min-h-screen place-items-center bg-bg-canvas"><Spinner className="h-6 w-6" /></div>
    } else if (canonicalClientProfile.status === 'error') {
      content = (
        <main className="grid min-h-screen place-items-center bg-bg-canvas p-6 text-center">
          <p className="max-w-md text-text-secondary">{canonicalClientProfile.message}</p>
        </main>
      )
    } else {
      content = <ClientPortalShell clientName={canonicalClientProfile.clientName} program="Obsidian Core" hash={hash} onSignOut={signOut} />
    }
  } else {
    content = <App />
  }

  return <>{content}<DevDoorSwitch role={door} /></>
}
