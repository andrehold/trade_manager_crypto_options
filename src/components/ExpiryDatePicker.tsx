import React from 'react'

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
      <button
        onClick={() => onSelect(null)}
        className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium tracking-wide transition-all ${
          selected === null
            ? 'bg-zinc-100 text-zinc-900 shadow-sm'
            : 'bg-transparent text-zinc-500 border border-zinc-700 hover:border-zinc-500 hover:text-zinc-300'
        }`}
      >
        All
      </button>
      {expiries.map((exp) => (
        <button
          key={exp}
          onClick={() => onSelect(exp === selected ? null : exp)}
          className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium tracking-wide transition-all ${
            exp === selected
              ? 'bg-zinc-100 text-zinc-900 shadow-sm'
              : 'bg-transparent text-zinc-500 border border-zinc-700 hover:border-zinc-500 hover:text-zinc-300'
          }`}
        >
          {formatExpiry(exp)}
        </button>
      ))}
    </div>
  )
}
