import React from 'react'

const TONE_MAP: Record<string, string> = {
  OPEN: 'tbl-badge-success',
  ATTENTION: 'tbl-badge-warning',
  ALERT: 'tbl-badge-danger',
  CLOSED: 'tbl-badge-neutral',
  EXPIRED: 'tbl-badge-danger',
}

const DOT_MAP: Record<string, string> = {
  OPEN: 'bg-status-success',
  ATTENTION: 'bg-status-warning',
  ALERT: 'bg-status-danger',
  CLOSED: 'bg-neutral-500',
  EXPIRED: 'bg-status-danger',
}

type StatusBadgeProps = {
  status: string
}

export const StatusBadge: React.FC<StatusBadgeProps> = React.memo(({ status }) => {
  const tone = TONE_MAP[status] ?? 'tbl-badge-neutral'
  const dot = DOT_MAP[status] ?? 'bg-neutral-500'

  return (
    <span className={`tbl-badge ${tone}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  )
})

StatusBadge.displayName = 'StatusBadge'
