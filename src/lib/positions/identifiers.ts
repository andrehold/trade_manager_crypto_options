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

  return null
}
