import React from 'react'
import { Chip } from './ui'

type Props = {
  expiries: string[]
  selected: string | null
  onSelect: (expiry: string | null) => void
}

function formatExpiry(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return d
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    })
    .toUpperCase()
}

export function ExpiryDatePicker({ expiries, selected, onSelect }: Props) {
  if (expiries.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 px-6 py-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      <Chip
        variant="date"
        selected={selected === null}
        onClick={() => onSelect(null)}
        className="flex-shrink-0"
      >
        All
      </Chip>
      {expiries.map((exp) => (
        <Chip
          key={exp}
          variant="date"
          selected={exp === selected}
          onClick={() => onSelect(exp === selected ? null : exp)}
          className="flex-shrink-0"
        >
          {formatExpiry(exp)}
        </Chip>
      ))}
    </div>
  )
}
