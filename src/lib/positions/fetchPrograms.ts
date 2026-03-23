import type { SupabaseClient, User } from '@supabase/supabase-js'

export type ProgramOption = { program_id: string; program_name: string }

export type FetchProgramsResult =
  | { ok: true; programs: ProgramOption[] }
  | { ok: false; error: string }

/**
 * Fetch all programs from the `programs` table via the Supabase REST API.
 * Returns `{ ok, programs }` on success or `{ ok, error }` on failure.
 */
export async function fetchPrograms(
  supabase: SupabaseClient,
  user: User,
  signal?: AbortSignal,
): Promise<FetchProgramsResult> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    console.error('Failed to retrieve Supabase session for program lookup', sessionError)
    return { ok: false, error: 'Could not load programs: session error.' }
  }

  const accessToken = session?.access_token
  if (!accessToken) {
    console.error('Missing Supabase access token while loading program options')
    return { ok: false, error: 'Could not load programs: not authenticated.' }
  }

  const supabaseUrl =
    (supabase as unknown as { supabaseUrl?: string }).supabaseUrl ??
    ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null)
  if (!supabaseUrl) {
    console.error('Supabase URL is not configured. Unable to load program options')
    return { ok: false, error: 'Could not load programs: configuration error.' }
  }

  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  if (!supabaseKey) {
    console.error('Supabase publishable key is not configured. Unable to load program options')
    return { ok: false, error: 'Could not load programs: configuration error.' }
  }

  const restBase = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/programs`
  const query = new URLSearchParams({ select: 'program_id,program_name', order: 'program_name' })
  const requestUrl = `${restBase}?${query.toString()}`

  try {
    const response = await fetch(requestUrl, {
      signal,
      headers: {
        Accept: 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'count=exact',
      },
    })

    if (!response.ok) {
      const body = await response.text()
      console.error('Failed to load program resources', {
        status: response.status,
        statusText: response.statusText,
        body,
      })
      return { ok: false, error: `Could not load programs (${response.status}).` }
    }

    const payload = (await response.json()) as unknown
    if (!Array.isArray(payload)) {
      console.error('Unexpected response shape when loading program resources', payload)
      return { ok: false, error: 'Could not load programs: unexpected response.' }
    }

    const rows = payload.filter(
      (row): row is ProgramOption =>
        Boolean(
          row &&
          typeof row === 'object' &&
          typeof (row as { program_id?: unknown }).program_id === 'string' &&
          typeof (row as { program_name?: unknown }).program_name === 'string',
        ),
    )

    return { ok: true, programs: rows }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'Aborted.' }
    }
    console.error('Failed to load program resources', err)
    return { ok: false, error: 'Could not load programs. Please try again.' }
  }
}
