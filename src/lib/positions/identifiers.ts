import type { TxnRow } from '@/utils'

export function sanitizeIdentifier(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed.length ? trimmed : null
}

export function extractIdentifier(row: TxnRow, type: 'trade' | 'order') {
  const candidates = [
    `${type}_id`,
    `${type}Id`,
    `${type}ID`,
    `${type}id`,
  ] as const

  for (const key of candidates) {
    const value = (row as Record<string, unknown>)[key]
    const sanitized = sanitizeIdentifier(value)
    if (sanitized) return sanitized
  }

  // Last resort: look for keys that normalize (remove separators and lowercase) to the same identifier
  const normalizedTarget = `${type}id`
  for (const [rawKey, rawValue] of Object.entries(row as Record<string, unknown>)) {
    const normalizedKey = rawKey.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    if (normalizedKey === normalizedTarget) {
      const sanitized = sanitizeIdentifier(rawValue)
      if (sanitized) return sanitized
    }
  }

  return null
}
