import type { User } from '@supabase/supabase-js'

type ClientAccess = {
  isAdmin: boolean
  clientName: string | null
  clientId: string | null
}

function getAdminEmailAllowlist(): string[] {
  const raw = (import.meta.env.VITE_SUPABASE_ADMIN_EMAILS as string | undefined) ?? ''
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0)
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function extractClientNameFromUser(user: User | null): string | null {
  const candidates: Array<unknown> = []
  if (user?.user_metadata) {
    candidates.push(
      (user.user_metadata as Record<string, unknown>).client_name,
      (user.user_metadata as Record<string, unknown>).client,
    )
  }
  if (user?.app_metadata) {
    candidates.push(
      (user.app_metadata as Record<string, unknown>).client_name,
      (user.app_metadata as Record<string, unknown>).client,
    )
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return null
}

function extractClientIdFromUser(user: User | null): string | null {
  const candidates: Array<unknown> = []
  if (user?.user_metadata) {
    candidates.push((user.user_metadata as Record<string, unknown>).client_id)
  }
  if (user?.app_metadata) {
    candidates.push((user.app_metadata as Record<string, unknown>).client_id)
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length === 0) continue
    if (/^[0-9a-fA-F-]{36}$/.test(trimmed)) {
      return trimmed
    }
  }

  return null
}

export function resolveClientAccess(user: User | null): ClientAccess {
  const allowlist = getAdminEmailAllowlist()
  const userEmail = normalizeEmail(user?.email ?? null)
  const role = typeof (user?.app_metadata as Record<string, unknown> | undefined)?.role === 'string'
    ? ((user?.app_metadata as Record<string, unknown>).role as string)
    : null
  const roleIsAdmin = role ? role.trim().toLowerCase() === 'admin' : false
  const allowlistEmpty = allowlist.length === 0
  const isAdmin = roleIsAdmin || allowlistEmpty || allowlist.includes(userEmail ?? '')
  const clientName = extractClientNameFromUser(user)
  const clientId = extractClientIdFromUser(user)
  return { isAdmin, clientName, clientId }
}

export type { ClientAccess }
