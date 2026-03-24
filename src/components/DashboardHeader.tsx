import React from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Check } from 'lucide-react'
import { fmtGreek } from '../utils'
import { IconButton, Chip } from './ui'

const HEADER_GREEKS = [
  { key: 'delta', symbol: 'Δ', label: 'Delta' },
  { key: 'gamma', symbol: 'Γ', label: 'Gamma' },
  { key: 'vega',  symbol: 'V', label: 'Vega'  },
  { key: 'theta', symbol: 'Θ', label: 'Theta' },
] as const

type HeaderGreekKey = typeof HEADER_GREEKS[number]['key']

type Props = {
  title: string
  clientName?: string
  clientOptions?: string[]
  onClientChange?: (name: string) => void
  portfolioGreeks: {
    totals: Record<string, number>
    hasValues: Record<string, boolean>
  }
}

function ClientChipDropdown({
  clientName,
  clientOptions,
  onClientChange,
}: {
  clientName: string
  clientOptions: string[]
  onClientChange: (name: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Chip
        variant="tag"
        className="type-micro font-semibold cursor-pointer hover:bg-bg-surface-4"
        onClick={() => setOpen((o) => !o)}
      >
        {clientName}
        <ChevronDown className={`w-3 h-3 ml-0.5 text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
      </Chip>

      {open && (
        <ul className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-border-default bg-bg-surface-2 py-1 shadow-lg">
          {clientOptions.map((name) => (
            <li key={name}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left type-micro transition-colors hover:bg-bg-surface-4 ${
                  name === clientName ? 'text-text-accent font-semibold' : 'text-text-primary'
                }`}
                onClick={() => { onClientChange(name); setOpen(false) }}
              >
                <span className="w-3.5 flex-shrink-0">
                  {name === clientName && <Check className="w-3.5 h-3.5" />}
                </span>
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DashboardHeader({ title, clientName, clientOptions, onClientChange, portfolioGreeks }: Props) {
  const hasDropdown = clientOptions && clientOptions.length > 1 && onClientChange

  return (
    <div className="flex items-center justify-between px-6 py-[18px] border-b border-border-default bg-bg-canvas">
      {/* Left: nav arrows + page title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5">
          <IconButton
            variant="ghost"
            size={32}
            icon={<ChevronLeft className="w-4 h-4" />}
            aria-label="Go back"
            onClick={() => window.history.back()}
          />
          <IconButton
            variant="ghost"
            size={32}
            icon={<ChevronRight className="w-4 h-4" />}
            aria-label="Go forward"
            onClick={() => window.history.forward()}
          />
        </div>
        <h1 className="type-headline font-semibold text-text-primary tracking-tight">{title}</h1>
      </div>

      {/* Right: client name + portfolio greeks (4 chips) */}
      <div className="flex items-center gap-1.5">
        {clientName && (
          <>
            {hasDropdown ? (
              <ClientChipDropdown
                clientName={clientName}
                clientOptions={clientOptions}
                onClientChange={onClientChange}
              />
            ) : (
              <Chip variant="tag" className="type-micro font-semibold">{clientName}</Chip>
            )}
            <div className="w-px h-4 bg-border-default mx-1" />
          </>
        )}
        {HEADER_GREEKS.map(({ key, symbol, label }) => {
          const value = portfolioGreeks.hasValues[key]
            ? fmtGreek(portfolioGreeks.totals[key])
            : '—'
          return (
            <Chip key={key} variant="tag" className="gap-1.5">
              <span className="type-micro font-medium text-text-tertiary">{symbol}</span>
              <span className="type-micro font-semibold text-text-primary tabular-nums">{value}</span>
            </Chip>
          )
        })}
      </div>
    </div>
  )
}
