import type { TxnRow } from '@/utils'

export function sanitizeIdentifier(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed.length ? trimmed : null
}

function hashString(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0 // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36)
}

export function deriveSyntheticDeliveryTradeId(
  row: TxnRow,
  raw: Record<string, unknown>,
): string | null {
  const type = sanitizeIdentifier(raw.type)
  const deliveryType = sanitizeIdentifier(raw.delivery_type)
  const action = sanitizeIdentifier((raw as any).action)

  const looksLikeDelivery = [type, deliveryType, action]
    .map((t) => t?.toLowerCase())
    .some((t) => t === 'delivery')

  if (!looksLikeDelivery) return null

  const deliveryId = sanitizeIdentifier(raw.delivery_id)
  if (deliveryId) return `D${deliveryId}`

  const signatureParts = [
    sanitizeIdentifier(row.instrument)?.toUpperCase(),
    sanitizeIdentifier(row.timestamp),
    sanitizeIdentifier(row.side)?.toLowerCase(),
    sanitizeIdentifier(row.action)?.toLowerCase(),
    Number.isFinite(row.amount) ? String(row.amount) : null,
    Number.isFinite(row.price) ? String(row.price) : null,
    sanitizeIdentifier(String(raw.exchange ?? row.exchange ?? ''))?.toLowerCase(),
  ].filter(Boolean) as string[]

  if (!signatureParts.length) return null

  const signature = signatureParts.join('|')
  return `D${hashString(signature)}`
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
