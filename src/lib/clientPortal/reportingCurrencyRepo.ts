import type { SupabaseClient } from '@supabase/supabase-js'

export type ReportingCurrencySource = 'client' | 'admin' | null

export type ReportingCurrencySelection = {
  clientId: string
  reportingCurrency: string | null
  reportingCurrencySource: ReportingCurrencySource
}

export type SaveReportingCurrencyResult =
  | { ok: true; selection: ReportingCurrencySelection }
  | { ok: false; error: string }

/** Mirrors the database's reporting-currency constraint. Invalid Hub labels are never choices. */
export function normalizeReportingCurrency(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z0-9]{2,12}$/.test(normalized) ? normalized : null
}

function asSource(value: unknown): ReportingCurrencySource {
  return value === 'client' || value === 'admin' ? value : null
}

/** Maps the RPC's snake_case table row into the client-facing selection. */
export function parseReportingCurrencySelection(row: unknown): ReportingCurrencySelection | null {
  if (typeof row !== 'object' || row === null) return null
  const value = row as Record<string, unknown>
  if (typeof value.client_id !== 'string') return null
  if (value.reporting_currency !== null && typeof value.reporting_currency !== 'string') return null
  const reportingCurrency = value.reporting_currency === null ? null : normalizeReportingCurrency(value.reporting_currency)
  if (value.reporting_currency !== null && reportingCurrency === null) return null
  const source = asSource(value.reporting_currency_source)
  // The database constraint keeps these fields paired. Treat malformed responses as failures
  // rather than presenting a selection whose provenance cannot be trusted.
  if ((reportingCurrency === null) !== (source === null)) return null
  return {
    clientId: value.client_id,
    reportingCurrency,
    reportingCurrencySource: source,
  }
}

/**
 * Saves through the narrow, client-scoped RPC. The database trigger records the audit event;
 * callers must not write audit rows themselves.
 */
export async function setOwnReportingCurrency(
  supabase: SupabaseClient,
  reportingCurrency: string | null,
): Promise<SaveReportingCurrencyResult> {
  const canonicalCurrency = reportingCurrency === null ? null : normalizeReportingCurrency(reportingCurrency)
  if (reportingCurrency !== null && canonicalCurrency === null) {
    return { ok: false, error: 'Reporting currency must be a 2-12 character uppercase currency code.' }
  }
  const { data, error } = await supabase.rpc('set_own_reporting_currency', {
    p_reporting_currency: canonicalCurrency,
  })
  if (error) return { ok: false, error: error.message }
  const rows = Array.isArray(data) ? data : data == null ? [] : [data]
  const selection = rows.length === 1 ? parseReportingCurrencySelection(rows[0]) : null
  if (!selection) return { ok: false, error: 'The reporting-currency service returned an invalid response. Please try again.' }
  return { ok: true, selection }
}
