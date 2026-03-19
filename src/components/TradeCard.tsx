import React from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Blocks,
  Calendar,
  Clock,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Badge } from './ui'

/* ── helpers ── */

function formatPremium(value: number): string {
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs % 1 === 0) return String(Math.round(abs))
  if (abs >= 1) return abs.toFixed(2)
  const magnitude = Math.floor(Math.log10(abs))
  const decimals = Math.max(2, -magnitude + 1)
  return abs.toFixed(decimals)
}

export function PremiumBadge({ value }: { value: number }) {
  if (value === 0) return null
  const isCredit = value < 0
  const sign = isCredit ? '+' : '-'
  return (
    <Badge variant={isCredit ? 'success' : 'danger'} className="gap-1 text-[11px] font-bold leading-tight">
      {isCredit
        ? <TrendingDown size={10} className="shrink-0" />
        : <TrendingUp size={10} className="shrink-0" />
      }
      {sign}{formatPremium(value)}
    </Badge>
  )
}

/* ── component ── */

export type TradeCardProps = {
  /** e.g. "+1 C25000" */
  label: string
  /** e.g. "28/09/2025" */
  expiryPart?: string
  /** e.g. "2025-09-28" */
  datePart?: string
  /** e.g. "10:00:00" */
  timePart?: string
  /** raw timestamp string used for the title tooltip */
  fullTimestamp?: string
  /** "open" | "close" */
  action?: string
  /** numeric premium value; positive = debit, negative = credit */
  premium?: number
  onRemove?: () => void
  /** merged into the root div – use for sizing/cursor overrides */
  className?: string
}

/**
 * Pure visual card. Accepts a forwarded ref and any extra div props (style,
 * data-*, aria-*, event listeners) so DnD wrappers can attach directly to the
 * root node without adding an extra DOM layer.
 */
export const TradeCard = React.forwardRef<
  HTMLDivElement,
  TradeCardProps & React.HTMLAttributes<HTMLDivElement>
>(function TradeCard(
  {
    label,
    expiryPart,
    datePart,
    timePart,
    fullTimestamp,
    action,
    premium,
    onRemove,
    className,
    ...rest
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`flex flex-col bg-bg-surface-1 border border-border-strong/60 rounded-xl px-3 py-2.5 select-none${className ? ' ' + className : ''}`}
      {...rest}
    >
      {/* Header: icon + label + remove */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Blocks size={13} className="shrink-0 text-text-tertiary" />
          <span className="type-caption font-bold text-text-primary truncate">{label}</span>
        </div>
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="shrink-0 text-text-disabled hover:text-rose-400 text-[11px] leading-none ml-1 transition-colors"
            title="Remove from structure"
          >
            ✕
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border-strong/60 my-2" />

      {/* Expiry */}
      {expiryPart && (
        <div className="flex items-center gap-1.5 mb-1">
          <Calendar size={11} className="shrink-0 text-text-tertiary" />
          <span className="text-[11px] text-text-secondary whitespace-nowrap">{expiryPart}</span>
        </div>
      )}

      {/* Timestamp */}
      {(datePart || timePart) && (
        <div className="flex items-center gap-1.5 mb-2">
          <Clock size={11} className="shrink-0 text-text-tertiary" />
          <span className="text-[11px] text-text-secondary whitespace-nowrap" title={fullTimestamp}>
            {datePart}{timePart ? ` ${timePart}` : ''}
          </span>
        </div>
      )}

      {/* Open/close chip */}
      {action && (
        <div className="mb-1">
          <Badge variant={action === 'open' ? 'info' : 'warning'} className="gap-1 text-[11px] font-bold leading-tight">
            {action === 'open'
              ? <ArrowUpRight size={10} className="shrink-0" />
              : <ArrowDownLeft size={10} className="shrink-0" />
            }
            {action}
          </Badge>
        </div>
      )}

      {/* Premium chip */}
      {premium !== undefined && premium !== 0 && (
        <div>
          <PremiumBadge value={premium} />
        </div>
      )}
    </div>
  )
})
