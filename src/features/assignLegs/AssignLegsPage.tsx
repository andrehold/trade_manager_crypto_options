import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ArrowLeft, Blocks, Calendar, Clock, EyeOff, RotateCcw } from 'lucide-react'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  rectIntersection,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type CollisionDetection,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TxnRow, Exchange, Position, Leg, parseInstrumentByExchange, daysTo } from '../../utils'
import type { StrategyOption } from '../../components/StructureDetailsOverlay'
import {
  LegItem,
  BoardState,
  generateLegId,
  formatLegLabel,
  formatStructureLabel,
  aggregateStructureLegs,
  suggestStructureType,
  STRUCTURE_TYPES,
} from '../../components/dndUtils'
import { buildStructureChipSummary } from '../../lib/positions'
import { getAssignLegsContext, clearAssignLegsContext } from './assignLegsStore'
import { PremiumBadge } from '../../components/TradeCard'
import { Button, Badge } from '../../components/ui'

const CONTAINER_BACKLOG = 'backlog'
const CONTAINER_NEW_STRUCTURE = 'new-structure'
const CONTAINER_EXCLUDED = 'excluded'
const BACKLOG_PAGE_SIZE = 15

/* ── premium helper ── */

function calcLegPremium(row: TxnRow): number {
  const qty = Math.abs(row.amount ?? 0)
  const price = row.price ?? 0
  return price * qty * (row.side === 'sell' ? 1 : -1)
}

/* ─────────────────────── types ─────────────────────── */

type SavedStructureInfo = {
  id: string
  label: string
  position: Position
}

/* ─────────────── sortable draggable wrapper ─────────────── */

function SortableLegChip({
  legItem,
  exchange,
  onRemove,
  className: extraClassName,
  showRemaining,
}: {
  legItem: LegItem
  exchange: Exchange
  onRemove?: () => void
  className?: string
  showRemaining?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: legItem.id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    ...(isDragging
      ? {
          transform: CSS.Transform.toString(transform) + ' scale(1.03)',
          boxShadow: 'var(--shadow-overlay)',
        }
      : {}),
  }

  const row = legItem.row
  const ts = row.timestamp ?? ''
  const timePart = ts.includes('T')
    ? ts.split('T')[1]?.slice(0, 8) ?? ''
    : ts.includes(' ')
    ? ts.split(' ')[1]?.slice(0, 8) ?? ''
    : ''
  const datePart = ts.slice(0, 10)
  const premium = calcLegPremium(row)
  const action = row.action

  const parsed = parseInstrumentByExchange(exchange, row.instrument)
  const qty = Math.abs(row.amount ?? 0)
  const qtyStr = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  const sign = row.side === 'sell' ? '-' : '+'
  const strikePart = parsed ? `${parsed.optionType}${parsed.strike}` : row.instrument
  const [exY, exM, exD] = (parsed?.expiryISO ?? '').split('-')
  const expiryPart = exD && exM && exY ? `${exD}/${exM}/${exY}` : ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex flex-col bg-bg-surface-1 border border-border-faint rounded-xl px-3 py-2.5 cursor-grab active:cursor-grabbing touch-none select-none min-w-[160px] flex-1 max-w-[260px] transition-transform${extraClassName ? ' ' + extraClassName : ''}`}
    >
      {/* Header: icon + qty+strike + remove */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Blocks size={13} className="shrink-0 text-text-tertiary" />
          <span className="type-caption font-bold text-text-primary truncate">
            {sign}{qtyStr} {strikePart}
          </span>
        </div>
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="shrink-0 text-text-disabled hover:text-status-danger type-caption leading-none ml-1 transition-colors"
            title="Remove from structure"
          >
            ✕
          </button>
        )}
      </div>

      {/* Reconcile mode: remaining / original size */}
      {showRemaining && legItem.originalAmount != null && legItem.originalAmount !== row.amount && (
        <div className="mt-1">
          <span className="inline-flex items-center gap-1 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5 type-caption text-amber-300">
            {qty} / {legItem.originalAmount} remaining
          </span>
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-border-faint my-2" />

      {/* Expiry */}
      {expiryPart && (
        <div className="flex items-center gap-1.5 mb-1">
          <Calendar size={11} className="shrink-0 text-text-tertiary" />
          <span className="type-caption text-text-secondary whitespace-nowrap">{expiryPart}</span>
        </div>
      )}

      {/* Timestamp */}
      {(datePart || timePart) && (
        <div className="flex items-center gap-1.5 mb-2">
          <Clock size={11} className="shrink-0 text-text-tertiary" />
          <span className="type-caption text-text-secondary whitespace-nowrap" title={ts}>
            {datePart}{timePart ? ` ${timePart}` : ''}
          </span>
        </div>
      )}

      {/* Open/close chip */}
      {action && (
        <div className="mb-1">
          <span className="inline-flex items-center gap-1 bg-bg-surface-3 rounded-md px-2 py-0.5 type-caption font-bold leading-tight text-text-primary">
            {action === 'open'
              ? <ArrowUpRight size={10} className="shrink-0 text-blue-400" />
              : <ArrowDownLeft size={10} className="shrink-0 text-orange-400" />
            }
            {action}
          </span>
        </div>
      )}

      {/* Premium chip */}
      {premium !== 0 && (
        <div>
          <PremiumBadge value={premium} />
        </div>
      )}
    </div>
  )
}

/* ─────────────── ghost chip while dragging ─────────────── */

function GhostChip({ legItem, exchange }: { legItem: LegItem; exchange: Exchange }) {
  return (
    <div
      className="flex flex-col bg-bg-surface-3 border border-border-accent rounded-xl px-2.5 py-2 shadow-2xl opacity-90 touch-none select-none min-w-[148px] max-w-[240px]"
    >
      <div className="flex items-center gap-1.5">
        <Blocks size={12} className="shrink-0 text-text-secondary" />
        <span className="type-caption font-bold text-text-primary truncate">
          {formatLegLabel(legItem.row, exchange)}
        </span>
      </div>
    </div>
  )
}

/* ─────────────── plain draggable chip (backlog only) ─────────────── */
// Uses useDraggable instead of useSortable — no SortableContext subscription,
// no rectSortingStrategy computation. Critical for performance with large backlogs.

function DraggableLegChip({
  legItem,
  exchange,
  onExclude,
  className: extraClassName,
  showRemaining,
}: {
  legItem: LegItem
  exchange: Exchange
  onExclude?: () => void
  className?: string
  showRemaining?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: legItem.id,
  })

  // Don't translate the original chip — DragOverlay renders the moving ghost.
  // Applying the transform would make the full-size chip chase the cursor alongside the overlay.
  const style: React.CSSProperties = isDragging ? { opacity: 0.35 } : {}

  const row = legItem.row
  const ts = row.timestamp ?? ''
  const timePart = ts.includes('T')
    ? ts.split('T')[1]?.slice(0, 8) ?? ''
    : ts.includes(' ')
    ? ts.split(' ')[1]?.slice(0, 8) ?? ''
    : ''
  const datePart = ts.slice(0, 10)
  const premium = calcLegPremium(row)
  const action = row.action

  const parsed = parseInstrumentByExchange(exchange, row.instrument)
  const qty = Math.abs(row.amount ?? 0)
  const qtyStr = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  const sign = row.side === 'sell' ? '-' : '+'
  const strikePart = parsed ? `${parsed.optionType}${parsed.strike}` : row.instrument
  const [exY, exM, exD] = (parsed?.expiryISO ?? '').split('-')
  const expiryPart = exD && exM && exY ? `${exD}/${exM}/${exY}` : ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex flex-col bg-bg-surface-1 border border-border-faint rounded-xl px-3 py-2.5 cursor-grab active:cursor-grabbing touch-none select-none min-w-[160px] flex-1 max-w-[260px]${extraClassName ? ' ' + extraClassName : ''}`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Blocks size={13} className="shrink-0 text-text-tertiary" />
          <span className="type-caption font-bold text-text-primary truncate">
            {sign}{qtyStr} {strikePart}
          </span>
        </div>
        {onExclude && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onExclude() }}
            className="shrink-0 text-text-disabled hover:text-status-warning leading-none ml-1 transition-colors"
            title="Save as unprocessed"
          >
            <EyeOff size={11} />
          </button>
        )}
      </div>

      <div className="border-t border-border-faint my-2" />

      {expiryPart && (
        <div className="flex items-center gap-1.5 mb-1">
          <Calendar size={11} className="shrink-0 text-text-tertiary" />
          <span className="type-caption text-text-secondary whitespace-nowrap">{expiryPart}</span>
        </div>
      )}

      {(datePart || timePart) && (
        <div className="flex items-center gap-1.5 mb-2">
          <Clock size={11} className="shrink-0 text-text-tertiary" />
          <span className="type-caption text-text-secondary whitespace-nowrap" title={ts}>
            {datePart}{timePart ? ` ${timePart}` : ''}
          </span>
        </div>
      )}

      {action && (
        <div className="mb-1">
          <span className="inline-flex items-center gap-1 bg-bg-surface-3 rounded-md px-2 py-0.5 type-caption font-bold leading-tight text-text-primary">
            {action === 'open'
              ? <ArrowUpRight size={10} className="shrink-0 text-blue-400" />
              : <ArrowDownLeft size={10} className="shrink-0 text-orange-400" />
            }
            {action}
          </span>
        </div>
      )}

      {premium !== 0 && (
        <div>
          <PremiumBadge value={premium} />
        </div>
      )}

      {/* Reconcile mode: remaining / original size */}
      {showRemaining && legItem.originalAmount != null && legItem.originalAmount !== row.amount && (
        <div className="mt-1">
          <span className="inline-flex items-center gap-1 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5 type-caption text-amber-300">
            {qty} / {legItem.originalAmount} remaining
          </span>
        </div>
      )}
    </div>
  )
}

/* ─────────────── droppable wrapper ─────────────── */

function Droppable({
  id,
  children,
  className,
  style,
}: {
  id: string
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${className ?? ''} ${isOver ? 'ring-2 ring-status-info-border ring-inset' : ''}`}
    >
      {children}
    </div>
  )
}

/* ─────────────── new-structure drop zone ─────────────── */

function NewStructureDropZone({
  items,
  exchange,
  structureType,
  strategyTypes,
  onStructureTypeChange,
  onSave,
  onSort,
  onRemoveItem,
}: {
  items: LegItem[]
  exchange: Exchange
  structureType: string
  strategyTypes: { code: string; label: string }[]
  onStructureTypeChange: (type: string) => void
  onSave: () => void
  onSort: () => void
  onRemoveItem: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: CONTAINER_NEW_STRUCTURE })
  const netPremium = items.length > 0 ? aggregateStructureLegs(items).totalNetPremium : null

  const handleAutoDetect = () => {
    if (items.length === 0) return
    const suggested = suggestStructureType(items)
    onStructureTypeChange(suggested)
  }

  return (
    <div
      ref={setNodeRef}
      className={`border border-dashed rounded-xl p-3 transition-colors ${
        isOver
          ? 'border-status-info-border bg-status-info-bg'
          : items.length > 0
          ? 'border-status-success-border bg-status-success-bg'
          : 'border-border-strong bg-bg-surface-1-alpha'
      }`}
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <select
            value={structureType}
            onChange={(e) => onStructureTypeChange(e.target.value)}
            className="bg-bg-surface-1 border border-border-strong rounded-lg px-1.5 py-0.5 type-caption text-text-secondary focus:outline-none focus:border-border-accent"
          >
            {strategyTypes.map((st) => (
              <option key={st.code} value={st.code}>
                {st.code} – {st.label}
              </option>
            ))}
          </select>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAutoDetect}
              className="!h-auto !px-2 !py-0.5 type-caption"
              title="Auto-detect structure type from legs"
            >
              Auto
            </Button>
          )}
          {netPremium !== null && <PremiumBadge value={netPremium} />}
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={onSort} className="!h-auto !px-2.5 !py-0.5 type-caption">
              Sort
            </Button>
            <Button variant="primary" size="sm" onClick={onSave} className="!h-auto !px-2.5 !py-0.5 type-caption">
              Save
            </Button>
          </div>
        )}
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-2 min-h-[36px] content-start">
          {items.length === 0 ? (
            <p className="type-caption text-text-disabled italic py-1">
              Drop legs here to create a new structure
            </p>
          ) : (
            items.map((item) => (
              <SortableLegChip
                key={item.id}
                legItem={item}
                exchange={exchange}
                onRemove={() => onRemoveItem(item.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/* ──────── read-only chip for existing legs in saved structures ──────── */

function ExistingLegChip({ leg }: { leg: Leg }) {
  const sign = leg.qtyNet >= 0 ? '+' : '-'
  const qty = Math.abs(leg.qtyNet)
  const qtyStr = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  return (
    <span className="inline-flex items-center gap-1 bg-bg-surface-3-alpha border border-border-accent rounded-lg px-2 py-1 type-caption text-text-secondary select-none">
      <span className="font-medium">
        {sign}{qtyStr} / {leg.optionType}{leg.strike}
      </span>
    </span>
  )
}

/* ─────────────── saved structure card ─────────────── */

function SavedStructureCard({
  structureId,
  label,
  existingLegs,
  newLegs,
  exchange,
  onRemoveItem,
}: {
  structureId: string
  label: string
  existingLegs: import('../../utils').Leg[]
  newLegs: LegItem[]
  exchange: Exchange
  onRemoveItem: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: structureId })
  const newLegsNetPremium = newLegs.length > 0 ? aggregateStructureLegs(newLegs).totalNetPremium : null

  return (
    <div
      ref={setNodeRef}
      className={`border rounded-xl px-3 py-2.5 transition-colors ${
        isOver ? 'border-status-info-border bg-status-info-bg' : 'border-border-strong bg-bg-surface-1-alpha'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <p className="type-caption font-semibold text-text-secondary truncate flex-1" title={label}>
          {label}
        </p>
        {newLegsNetPremium !== null && <PremiumBadge value={newLegsNetPremium} />}
      </div>
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          {existingLegs.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {existingLegs.map((leg, i) => (
                <ExistingLegChip key={`existing-${i}`} leg={leg} />
              ))}
            </div>
          ) : (
            <p className="type-caption text-text-disabled italic">No legs</p>
          )}
        </div>
        <SortableContext items={newLegs.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div
            className={`flex-1 min-w-0 border border-dashed rounded-xl p-2 min-h-[36px] transition-colors ${
              isOver ? 'border-status-info-border bg-status-info-bg' : 'border-border-strong bg-bg-surface-1-alpha'
            }`}
          >
            {newLegs.length === 0 ? (
              <p className="type-caption text-text-disabled italic text-center py-0.5">Drop legs to add</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {newLegs.map((item) => (
                  <SortableLegChip
                    key={item.id}
                    legItem={item}
                    exchange={exchange}
                    onRemove={() => onRemoveItem(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </SortableContext>
      </div>
    </div>
  )
}

/* ─────────────── local (unsaved) structure card ─────────────── */

function LocalStructureCard({
  structureId,
  items,
  meta,
  exchange,
  strategyTypes,
  onTypeChange,
  onRemove,
  onRemoveItem,
}: {
  structureId: string
  items: LegItem[]
  meta: { type: string }
  exchange: Exchange
  strategyTypes: { code: string; label: string }[]
  onTypeChange: (type: string) => void
  onRemove: () => void
  onRemoveItem: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: structureId })
  const netPremium = items.length > 0 ? aggregateStructureLegs(items).totalNetPremium : null

  return (
    <div
      ref={setNodeRef}
      className={`border rounded-xl p-3 transition-colors ${
        isOver ? 'border-status-info-border bg-status-info-bg' : 'border-border-strong bg-bg-surface-1-alpha'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="type-caption font-semibold text-text-secondary truncate flex-1">
          {formatStructureLabel(items, meta.type)}
        </p>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {netPremium !== null && <PremiumBadge value={netPremium} />}
          <select
            value={meta.type}
            onChange={(e) => onTypeChange(e.target.value)}
            className="bg-bg-surface-1 border border-border-strong rounded-lg px-1.5 py-0.5 type-caption text-text-secondary focus:outline-none focus:border-border-accent"
          >
            {strategyTypes.map((st) => (
              <option key={st.code} value={st.code}>
                {st.code} – {st.label}
              </option>
            ))}
          </select>
          <button
            onClick={onRemove}
            className="type-caption text-text-disabled hover:text-status-danger transition-colors"
            title="Delete structure"
          >
            ✕
          </button>
        </div>
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-2 min-h-[28px] content-start">
          {items.length === 0 ? (
            <p className="type-caption text-text-disabled italic py-0.5">Drop legs here</p>
          ) : (
            items.map((item) => (
              <SortableLegChip
                key={item.id}
                legItem={item}
                exchange={exchange}
                onRemove={() => onRemoveItem(item.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/* ═══════════════════════ MAIN PAGE ═══════════════════════ */

export function AssignLegsPage({ onBack, embedded }: { onBack: () => void; embedded?: boolean }) {
  const ctx = getAssignLegsContext()

  useEffect(() => {
    if (!ctx) onBack()
  }, [ctx, onBack])

  if (!ctx) return null

  return <AssignLegsPageInner {...ctx} onBack={onBack} embedded={embedded} />
}

/* ── Split Modal for reconcile mode ── */
function SplitModal({
  legItem,
  targetLabel,
  onConfirm,
  onCancel,
}: {
  legItem: LegItem
  targetLabel: string
  onConfirm: (qty: number) => void
  onCancel: () => void
}) {
  const remaining = legItem.row.amount
  const [qty, setQty] = React.useState(String(remaining))
  const numQty = parseFloat(qty)
  const isValid = !isNaN(numQty) && numQty > 0 && numQty <= remaining

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-bg-surface-1 border border-border-strong rounded-2xl shadow-xl max-w-sm w-full mx-4 p-5">
        <h4 className="type-body font-semibold text-text-primary mb-3">
          Split & Assign
        </h4>
        <p className="type-caption text-text-secondary mb-1">
          {legItem.row.side === 'buy' ? 'Long' : 'Short'}{' '}
          <span className="font-mono font-medium text-text-primary">{legItem.row.instrument}</span>
        </p>
        <p className="type-caption text-text-muted mb-3">
          Avg price: {legItem.row.price} &middot; Remaining: {remaining}
        </p>
        <div className="mb-4">
          <label className="type-caption text-text-secondary block mb-1">
            Assign how many to <span className="font-medium text-text-primary">{targetLabel}</span>?
          </label>
          <input
            type="number"
            step="any"
            min={0}
            max={remaining}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-full bg-bg-surface-2 border border-border-strong rounded-lg px-3 py-2 type-body text-text-primary focus:outline-none focus:border-border-accent"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isValid) onConfirm(numQty)
              if (e.key === 'Escape') onCancel()
            }}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg type-caption text-text-secondary hover:bg-bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => isValid && onConfirm(numQty)}
            disabled={!isValid}
            className="px-3 py-1.5 rounded-lg type-caption font-medium bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Assign {isValid ? numQty : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function AssignLegsPageInner({
  rows,
  noImportRows = [],
  processedRows = [],
  exchange,
  savedStructures = [],
  strategies = [],
  onConfirm,
  onCancel,
  onBack,
  embedded,
  mode,
}: {
  rows: TxnRow[]
  noImportRows?: TxnRow[]
  processedRows?: { row: TxnRow; source: 'structure' | 'unprocessed_imports' }[]
  exchange: Exchange
  savedStructures?: Position[]
  strategies?: StrategyOption[]
  onConfirm: (rows: TxnRow[], unprocessedRows?: TxnRow[]) => void | Promise<void>
  onCancel: () => void
  onBack: () => void
  embedded?: boolean
  mode?: 'import' | 'reconcile'
}) {
  const isReconcileMode = mode === 'reconcile'
  // Use DB strategies when available, fall back to hardcoded STRUCTURE_TYPES
  const strategyTypes = useMemo(() => {
    if (strategies.length > 0) {
      return strategies.map((s) => ({ code: s.strategy_code, label: s.strategy_name }))
    }
    return STRUCTURE_TYPES.map((st) => ({ code: st.code, label: st.label }))
  }, [strategies])

  const [activeTab, setActiveTab] = useState<'open' | 'no_import' | 'unprocessed' | 'processed'>('open')
  const [importing, setImporting] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [activeDragSourceContainer, setActiveDragSourceContainer] = useState<string | null>(null)
  const [newStructureType, setNewStructureType] = useState<string>('IC')
  const [backlogPage, setBacklogPage] = useState(0)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  // Reconcile mode: pending split
  const [pendingSplit, setPendingSplit] = useState<{
    itemId: string
    targetContainerId: string
    targetLabel: string
  } | null>(null)
  const [splitCounter, setSplitCounter] = useState(0)
  const [filterFutureOnly, setFilterFutureOnly] = useState(false)
  const [filterAction, setFilterAction] = useState<'open' | 'close' | null>(null)
  const [backlogSortDir, setBacklogSortDir] = useState<'asc' | 'desc'>('asc')

  /* ── build saved-structure info ── */
  const savedStructureInfos = useMemo<SavedStructureInfo[]>(() => {
    return savedStructures
      .filter((s) => !s.archived && !s.archivedAt)
      .map((s) => ({
        id: s.id,
        label: buildStructureChipSummary(s) ?? s.underlying ?? 'Structure',
        position: s,
      }))
  }, [savedStructures])

  /* ── initialize board ── */
  const initialBoard = useMemo((): BoardState => {
    const itemsById: Record<string, LegItem> = {}
    const containers: Record<string, string[]> = {
      [CONTAINER_BACKLOG]: [],
      [CONTAINER_NEW_STRUCTURE]: [],
      [CONTAINER_EXCLUDED]: [],
    }
    const structureOrder: string[] = []
    const structureMeta: Record<string, { type: string }> = {}

    const sorted = [...rows].sort((a, b) => {
      const ta = a.timestamp ?? ''
      const tb = b.timestamp ?? ''
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })

    // All rows start in the backlog — user manually creates structures
    sorted.forEach((row, idx) => {
      const id = generateLegId(row, idx)
      const item: LegItem = { id, row, included: true }
      if (isReconcileMode) {
        item.originalAmount = row.amount
        item.sourceRowKey = row.trade_id ?? `source-${idx}`
      }
      itemsById[id] = item
      containers[CONTAINER_BACKLOG].push(id)
    })

    for (const info of savedStructureInfos) {
      containers[`saved:${info.id}`] = []
    }

    return { itemsById, containers, structureOrder, structureMeta }
  }, [rows, savedStructureInfos])

  const [board, setBoard] = useState(initialBoard)

  useEffect(() => {
    setBoard((prev) => {
      const hasContent = Object.values(prev.containers).some(ids => ids.length > 0)
      if (hasContent) return prev  // Don't reset if user has already arranged legs
      return initialBoard
    })
  }, [initialBoard])

  /* ── sensors ── */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  /* ── container IDs ── */
  const containerIds = useMemo(() => new Set(Object.keys(board.containers)), [board.containers])

  /* ── find container for an item ── */
  const findContainer = useCallback((itemId: string, state: BoardState): string | null => {
    if (state.containers[itemId] !== undefined) return itemId
    for (const [cId, ids] of Object.entries(state.containers)) {
      if (ids.includes(itemId)) return cId
    }
    return null
  }, [])

  /* ── custom collision detection ── */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerCollisions = pointerWithin(args)
      if (pointerCollisions.length > 0) {
        const containerHit = pointerCollisions.find((c) => containerIds.has(c.id as string))
        if (containerHit) return [containerHit]
        return [pointerCollisions[0]]
      }
      const rectCollisions = rectIntersection(args)
      if (rectCollisions.length > 0) {
        const containerHit = rectCollisions.find((c) => containerIds.has(c.id as string))
        if (containerHit) return [containerHit]
        return [rectCollisions[0]]
      }
      return []
    },
    [containerIds],
  )

  /* ── move item between containers ── */
  const moveItem = useCallback(
    (activeId: string, targetContainerId: string) => {
      setBoard((prev) => {
        const srcId = findContainer(activeId, prev)
        if (!srcId || srcId === targetContainerId) return prev
        const next = {
          ...prev,
          containers: { ...prev.containers },
          structureOrder: [...prev.structureOrder],
          structureMeta: { ...prev.structureMeta },
        }
        for (const k of Object.keys(next.containers)) {
          next.containers[k] = [...next.containers[k]]
        }
        next.containers[srcId] = next.containers[srcId].filter((id) => id !== activeId)
        next.containers[targetContainerId].push(activeId)
        return next
      })
    },
    [findContainer],
  )

  /* ── drag handlers ── */
  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string
    setActiveDragId(id)
    setActiveDragSourceContainer(findContainer(id, board))
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    const activeId = active.id as string
    const overId = over.id as string
    const targetContainerId = containerIds.has(overId) ? overId : findContainer(overId, board)
    if (!targetContainerId) return
    const srcContainerId = findContainer(activeId, board)
    if (!srcContainerId || srcContainerId === targetContainerId) return

    // In reconcile mode, don't move backlog items during hover — the split modal
    // handles the actual assignment at drag end. Allow intra-structure moves freely.
    if (
      isReconcileMode &&
      activeDragSourceContainer === CONTAINER_BACKLOG &&
      targetContainerId !== CONTAINER_BACKLOG &&
      targetContainerId !== CONTAINER_EXCLUDED
    ) return

    moveItem(activeId, targetContainerId)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)
    const dragSource = activeDragSourceContainer
    setActiveDragSourceContainer(null)
    if (!over) return
    const activeId = active.id as string
    const overId = over.id as string
    const targetContainerId = containerIds.has(overId) ? overId : findContainer(overId, board)
    if (!targetContainerId) return

    // In reconcile mode, dropping a backlog item onto a structure opens the split modal.
    // (hover-moves were suppressed so the item is still in backlog at this point)
    if (
      isReconcileMode &&
      dragSource === CONTAINER_BACKLOG &&
      targetContainerId !== CONTAINER_BACKLOG &&
      targetContainerId !== CONTAINER_EXCLUDED
    ) {
      const targetLabel =
        targetContainerId === CONTAINER_NEW_STRUCTURE
          ? 'New Structure'
          : targetContainerId.startsWith('saved:')
          ? (savedStructureInfos.find((s) => `saved:${s.id}` === targetContainerId)?.label ?? 'Saved Structure')
          : board.structureMeta[targetContainerId]?.type
          ? `Structure (${board.structureMeta[targetContainerId].type})`
          : 'Structure'
      setPendingSplit({ itemId: activeId, targetContainerId, targetLabel })
      return
    }

    moveItem(activeId, targetContainerId)
  }

  /* ── reconcile mode: handle split confirm ── */
  const handleSplitConfirm = useCallback(
    (qty: number) => {
      if (!pendingSplit) return
      const { itemId, targetContainerId } = pendingSplit
      setPendingSplit(null)

      setBoard((prev) => {
        const item = prev.itemsById[itemId]
        if (!item) return prev
        const remaining = item.row.amount - qty
        const next = {
          ...prev,
          itemsById: { ...prev.itemsById },
          containers: { ...prev.containers },
        }
        for (const k of Object.keys(next.containers)) {
          next.containers[k] = [...next.containers[k]]
        }

        // Create split item for the target
        const splitId = `${itemId}:split-${splitCounter}`
        const splitItem: LegItem = {
          id: splitId,
          row: { ...item.row, amount: qty },
          included: true,
          originalAmount: item.originalAmount,
          sourceRowKey: item.sourceRowKey,
        }

        if (remaining <= 0.000001) {
          // Fully assigned — remove from backlog, add split to target
          next.containers[CONTAINER_BACKLOG] = next.containers[CONTAINER_BACKLOG].filter(
            (id) => id !== itemId,
          )
          delete next.itemsById[itemId]
        } else {
          // Partially assigned — reduce backlog item's amount
          next.itemsById[itemId] = {
            ...item,
            row: { ...item.row, amount: remaining },
          }
        }

        // Add split to target container
        next.itemsById[splitId] = splitItem
        if (!next.containers[targetContainerId]) {
          next.containers[targetContainerId] = []
        }
        next.containers[targetContainerId].push(splitId)

        return next
      })
      setSplitCounter((c) => c + 1)
    },
    [pendingSplit, splitCounter],
  )

  /* ── derived data ── */
  const backlogItems = (board.containers[CONTAINER_BACKLOG] ?? []).map((id) => board.itemsById[id])
  const newStructureItems = (board.containers[CONTAINER_NEW_STRUCTURE] ?? []).map(
    (id) => board.itemsById[id],
  )
  const manuallyExcludedItems = (board.containers[CONTAINER_EXCLUDED] ?? []).map(
    (id) => board.itemsById[id],
  )
  const localStructureIds = board.structureOrder.filter((id) => board.containers[id])
  const filteredBacklogItems = useMemo(() => {
    let items = backlogItems
    if (filterFutureOnly) items = items.filter(item => item.row.expiry && daysTo(item.row.expiry) >= 0)
    if (filterAction) items = items.filter(item => item.row.action === filterAction)
    const dir = backlogSortDir === 'asc' ? 1 : -1
    items = [...items].sort((a, b) => {
      const ta = a.row.timestamp ?? ''
      const tb = b.row.timestamp ?? ''
      return ta < tb ? -dir : ta > tb ? dir : 0
    })
    return items
  }, [backlogItems, filterFutureOnly, filterAction, backlogSortDir])
  const backlogCount = filteredBacklogItems.length
  const newStructureCount = newStructureItems.length
  const canImport = newStructureCount === 0

  /* ── backlog pagination ── */
  const totalBacklogPages = Math.max(1, Math.ceil(backlogCount / BACKLOG_PAGE_SIZE))
  const currentPage = Math.min(backlogPage, totalBacklogPages - 1)
  const pageStart = currentPage * BACKLOG_PAGE_SIZE
  const pageEnd = Math.min(pageStart + BACKLOG_PAGE_SIZE, backlogCount)
  const visibleBacklogItems = filteredBacklogItems.slice(pageStart, pageEnd)

  /* ── sort new-structure items ── */
  const handleSortNewStructure = useCallback(() => {
    setBoard((prev) => {
      const ids = [...(prev.containers[CONTAINER_NEW_STRUCTURE] ?? [])]
      ids.sort((a, b) => {
        const rowA = prev.itemsById[a]?.row
        const rowB = prev.itemsById[b]?.row
        if (!rowA || !rowB) return 0
        const parsedA = parseInstrumentByExchange(exchange, rowA.instrument)
        const parsedB = parseInstrumentByExchange(exchange, rowB.instrument)
        const expiryA = parsedA?.expiryISO ?? ''
        const expiryB = parsedB?.expiryISO ?? ''
        if (expiryA !== expiryB) return expiryA < expiryB ? -1 : 1
        return (parsedA?.strike ?? 0) - (parsedB?.strike ?? 0)
      })
      return { ...prev, containers: { ...prev.containers, [CONTAINER_NEW_STRUCTURE]: ids } }
    })
  }, [exchange])

  /* ── save new structure → local structure ── */
  const handleSaveNewStructure = () => {
    if (newStructureItems.length === 0) return
    const typeToSave = newStructureType
    setBoard((prev) => {
      const next = {
        ...prev,
        containers: { ...prev.containers },
        structureOrder: [...prev.structureOrder],
        structureMeta: { ...prev.structureMeta },
      }
      for (const k of Object.keys(next.containers)) {
        next.containers[k] = [...next.containers[k]]
      }
      const structId = `structure:${Date.now()}`
      next.containers[structId] = next.containers[CONTAINER_NEW_STRUCTURE]
      next.containers[CONTAINER_NEW_STRUCTURE] = []
      next.structureOrder.push(structId)
      next.structureMeta[structId] = { type: typeToSave }
      return next
    })
    setNewStructureType('IC')
  }

  /* ── remove item → back to backlog ── */
  const handleRemoveItem = useCallback(
    (itemId: string) => {
      setBoard((prev) => {
        const next = { ...prev, containers: { ...prev.containers } }
        for (const k of Object.keys(next.containers)) {
          next.containers[k] = [...next.containers[k]]
        }
        const srcId = findContainer(itemId, next)
        if (!srcId || srcId === CONTAINER_BACKLOG) return prev
        next.containers[srcId] = next.containers[srcId].filter((id) => id !== itemId)
        next.containers[CONTAINER_BACKLOG] = [...next.containers[CONTAINER_BACKLOG], itemId]
        next.containers[CONTAINER_BACKLOG].sort((a, b) => {
          const ta = next.itemsById[a]?.row.timestamp ?? ''
          const tb = next.itemsById[b]?.row.timestamp ?? ''
          return ta < tb ? -1 : ta > tb ? 1 : 0
        })
        return next
      })
    },
    [findContainer],
  )

  /* ── exclude item → excluded container ── */
  const handleExcludeItem = useCallback(
    (itemId: string) => {
      setBoard((prev) => {
        const next = { ...prev, containers: { ...prev.containers } }
        for (const k of Object.keys(next.containers)) {
          next.containers[k] = [...next.containers[k]]
        }
        const srcId = findContainer(itemId, next)
        if (!srcId || srcId === CONTAINER_EXCLUDED) return prev
        next.containers[srcId] = next.containers[srcId].filter((id) => id !== itemId)
        next.containers[CONTAINER_EXCLUDED] = [...next.containers[CONTAINER_EXCLUDED], itemId]
        return next
      })
    },
    [findContainer],
  )

  /* ── restore item → back to backlog ── */
  const handleRestoreItem = useCallback(
    (itemId: string) => {
      setBoard((prev) => {
        const next = { ...prev, containers: { ...prev.containers } }
        for (const k of Object.keys(next.containers)) {
          next.containers[k] = [...next.containers[k]]
        }
        next.containers[CONTAINER_EXCLUDED] = next.containers[CONTAINER_EXCLUDED].filter(
          (id) => id !== itemId,
        )
        next.containers[CONTAINER_BACKLOG] = [...next.containers[CONTAINER_BACKLOG], itemId]
        next.containers[CONTAINER_BACKLOG].sort((a, b) => {
          const ta = next.itemsById[a]?.row.timestamp ?? ''
          const tb = next.itemsById[b]?.row.timestamp ?? ''
          return ta < tb ? -1 : ta > tb ? 1 : 0
        })
        return next
      })
    },
    [],
  )

  /* ── delete local structure → legs back to backlog ── */
  const handleRemoveStructure = (structureId: string) => {
    setBoard((prev) => {
      const next = {
        ...prev,
        containers: { ...prev.containers },
        structureOrder: [...prev.structureOrder],
        structureMeta: { ...prev.structureMeta },
      }
      for (const k of Object.keys(next.containers)) {
        next.containers[k] = [...next.containers[k]]
      }
      const itemIds = next.containers[structureId] ?? []
      next.containers[CONTAINER_BACKLOG] = [...next.containers[CONTAINER_BACKLOG], ...itemIds]
      next.containers[CONTAINER_BACKLOG].sort((a, b) => {
        const ta = next.itemsById[a]?.row.timestamp ?? ''
        const tb = next.itemsById[b]?.row.timestamp ?? ''
        return ta < tb ? -1 : ta > tb ? 1 : 0
      })
      delete next.containers[structureId]
      next.structureOrder = next.structureOrder.filter((id) => id !== structureId)
      delete next.structureMeta[structureId]
      return next
    })
  }

  const handleStructureTypeChange = (structureId: string, type: string) => {
    setBoard((prev) => ({
      ...prev,
      structureMeta: {
        ...prev.structureMeta,
        [structureId]: { ...prev.structureMeta[structureId], type },
      },
    }))
  }

  /* ── import ── */
  const handleImport = async () => {
    if (!canImport || importing) return
    const payload: TxnRow[] = []

    for (const structureId of board.structureOrder) {
      const itemIds = board.containers[structureId] || []
      const structureType = board.structureMeta[structureId]?.type
      for (const itemId of itemIds) {
        const item = board.itemsById[itemId]
        if (item?.included) payload.push({ ...item.row, structureId, structureType })
      }
    }

    for (const info of savedStructureInfos) {
      const containerId = `saved:${info.id}`
      const itemIds = board.containers[containerId] || []
      for (const itemId of itemIds) {
        const item = board.itemsById[itemId]
        if (item?.included) {
          payload.push({ ...item.row, structureId: info.id, linkedStructureId: info.id })
        }
      }
    }

    const unprocessedRows: TxnRow[] = [
      ...(board.containers[CONTAINER_EXCLUDED] ?? []),
      ...(board.containers[CONTAINER_BACKLOG] ?? []),
    ]
      .map((itemId) => board.itemsById[itemId])
      .filter((item): item is LegItem => item != null)
      .map((item) => item.row)

    if (payload.length === 0 && unprocessedRows.length === 0) return

    try {
      setImporting(true)
      await onConfirm(payload, unprocessedRows)
      clearAssignLegsContext()
      onBack()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import trades.'
      alert(message)
    } finally {
      setImporting(false)
    }
  }

  const handleCancel = () => {
    clearAssignLegsContext()
    onCancel()
    onBack()
  }

  /* ── validation message ── */
  // In reconcile mode, count backlog items that still have remaining size > 0
  const unassignedReconcileCount = isReconcileMode
    ? (board.containers[CONTAINER_BACKLOG] ?? []).filter((id) => {
        const item = board.itemsById[id]
        return item && item.row.amount > 0
      }).length
    : 0

  const validationMsg = (() => {
    const parts: string[] = []
    if (newStructureCount > 0)
      parts.push(`Drag the ${newStructureCount} leg${newStructureCount !== 1 ? 's' : ''} out of 'New Structure' or click Save Structure before importing`)
    if (isReconcileMode && unassignedReconcileCount > 0)
      parts.push(`${unassignedReconcileCount} position${unassignedReconcileCount !== 1 ? 's' : ''} not fully assigned — unassigned lots will be saved as standalone legs`)
    return parts.length > 0 ? parts.join('. ') : null
  })()

  /* ═════════════════════ RENDER ═════════════════════ */

  return (
    <div className={embedded ? 'flex-1 min-h-0 flex flex-col bg-bg-canvas' : 'h-screen flex flex-col bg-bg-canvas'}>
      {/* ── header ── */}
      <div className="shrink-0 flex items-center gap-3 px-6 pt-5 pb-3 border-b border-border-default">
        {!embedded && (
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-lg hover:bg-bg-surface-2 text-text-secondary transition-colors"
            title="Back to dashboard"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        {!embedded && (
          <h3 className="type-subhead font-semibold text-text-primary tracking-tight">Assign Legs to Structures</h3>
        )}
        {isReconcileMode && (
          <span className="inline-flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 rounded-lg px-2.5 py-1 type-caption text-amber-300 font-medium">
            Reconcile Mode — drag legs to split across structures
          </span>
        )}
        <div className="flex gap-2">
          {([
            { key: 'open' as const, label: 'Open', count: backlogCount },
            { key: 'no_import' as const, label: 'No Import', count: noImportRows.length },
            { key: 'unprocessed' as const, label: 'Unprocessed', count: manuallyExcludedItems.length },
            { key: 'processed' as const, label: 'Processed', count: processedRows.length },
          ]).map(({ key, label, count }) => (
            <Button
              key={key}
              variant={activeTab === key ? 'primary' : 'secondary'}
              size="sm"
              className="type-caption font-bold uppercase tracking-[0.1em]"
              onClick={() => setActiveTab(key)}
            >
              {label} ({count})
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* Cancel button with confirmation popover */}
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowCancelConfirm(true)}
              className="type-caption font-bold"
            >
              Cancel
            </Button>
            {showCancelConfirm && (
              <div className="absolute right-0 top-full mt-2 z-modal w-68 bg-bg-surface-2 border border-border-strong rounded-xl shadow-2xl p-4">
                <p className="type-body text-text-primary mb-4">You have unsaved changes. Would you cancel?</p>
                <div className="flex gap-2 justify-end">
                  <Button variant="secondary" size="sm" onClick={() => setShowCancelConfirm(false)}>
                    No
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => { clearAssignLegsContext(); onCancel(); onBack(); }}>
                    Yes
                  </Button>
                </div>
              </div>
            )}
          </div>
          {validationMsg && (
            <span className="type-caption font-bold banner-warning border rounded-lg px-3 py-1">
              {validationMsg}
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleImport}
            disabled={!canImport || importing}
            loading={importing}
            title={
              importing
                ? 'Import in progress…'
                : !canImport && validationMsg
                ? validationMsg
                : undefined
            }
            className="type-caption font-bold"
          >
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </div>

      {/* ── body ── */}
      <div className="flex-1 min-h-0 overflow-hidden px-6 py-4">
        {activeTab === 'open' ? (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-5 h-full overflow-hidden">
              {/* ──── LEFT COLUMN: Backlog ──── */}
              <div className="flex-1 min-w-0 flex flex-col">
                {/* Header row: label + pagination controls */}
                <div className="shrink-0 flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <p className="type-caption font-semibold text-text-tertiary uppercase tracking-[0.12em]">
                      New Legs ({backlogCount})
                    </p>
                    <button
                      onClick={() => { setFilterFutureOnly(f => !f); setBacklogPage(0) }}
                      className={`px-2 py-0.5 rounded-full type-caption font-medium transition-colors ${
                        filterFutureOnly
                          ? 'bg-accent-500 text-text-primary'
                          : 'bg-bg-surface-1 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      Future only
                    </button>
                    <button
                      onClick={() => { setFilterAction(a => a === 'open' ? null : 'open'); setBacklogPage(0) }}
                      className={`px-2 py-0.5 rounded-full type-caption font-medium transition-colors ${
                        filterAction === 'open'
                          ? 'bg-accent-500 text-text-primary'
                          : 'bg-bg-surface-1 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      Open
                    </button>
                    <button
                      onClick={() => { setFilterAction(a => a === 'close' ? null : 'close'); setBacklogPage(0) }}
                      className={`px-2 py-0.5 rounded-full type-caption font-medium transition-colors ${
                        filterAction === 'close'
                          ? 'bg-accent-500 text-text-primary'
                          : 'bg-bg-surface-1 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      Close
                    </button>
                    <select
                      value={backlogSortDir}
                      onChange={(e) => { setBacklogSortDir(e.target.value as 'asc' | 'desc'); setBacklogPage(0) }}
                      className="rounded-lg border border-border-default bg-bg-surface-1 px-2 py-0.5 type-caption text-text-primary focus:outline-none focus:shadow-[var(--glow-accent-sm)]"
                    >
                      <option value="asc">Sort by: oldest first</option>
                      <option value="desc">Sort by: newest first</option>
                    </select>
                  </div>
                  {backlogCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setBacklogPage(p => Math.max(0, p - 1))}
                        disabled={currentPage === 0}
                        className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-bg-surface-4 disabled:opacity-30 disabled:cursor-not-allowed transition-colors type-caption"
                      >
                        ‹
                      </button>
                      <span className="type-caption text-text-tertiary tabular-nums">
                        {pageStart + 1}–{pageEnd} of {backlogCount}
                      </span>
                      <button
                        onClick={() => setBacklogPage(p => Math.min(totalBacklogPages - 1, p + 1))}
                        disabled={currentPage >= totalBacklogPages - 1}
                        className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-bg-surface-4 disabled:opacity-30 disabled:cursor-not-allowed transition-colors type-caption"
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
                <Droppable
                  id={CONTAINER_BACKLOG}
                  className="flex-1 min-h-0 rounded-xl p-3 bg-bg-surface-1 border border-border-default"
                >
                  <div className="grid grid-cols-2 gap-2">
                    {backlogCount === 0 ? (
                      <p className="type-caption text-text-disabled italic text-center py-4 col-span-2">
                        All legs assigned
                      </p>
                    ) : (
                      visibleBacklogItems.map((item) => (
                        <DraggableLegChip key={item.id} legItem={item} exchange={exchange} onExclude={() => handleExcludeItem(item.id)} className="w-full min-w-0 flex-none" showRemaining={isReconcileMode} />
                      ))
                    )}
                  </div>
                </Droppable>
              </div>

              {/* ──── RIGHT COLUMN: Structures ──── */}
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                {/* Pinned: New structure drop zone */}
                <div className="shrink-0">
                  <p className="type-caption font-semibold text-text-tertiary uppercase tracking-[0.12em] mb-2">
                    New Structure
                  </p>
                  <NewStructureDropZone
                    items={newStructureItems}
                    exchange={exchange}
                    structureType={newStructureType}
                    strategyTypes={strategyTypes}
                    onStructureTypeChange={setNewStructureType}
                    onSave={handleSaveNewStructure}
                    onSort={handleSortNewStructure}
                    onRemoveItem={handleRemoveItem}
                  />
                </div>

                {/* Scrollable: structure cards */}
                <p className="shrink-0 type-caption font-semibold text-text-tertiary uppercase tracking-[0.12em] mb-2">
                  Saved Structures
                </p>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-3 bg-bg-surface-1 border border-border-default rounded-xl p-3">
                  {/* Local (unsaved) structures */}
                  {localStructureIds.length > 0 && (
                    <div>
                      <p className="type-caption font-semibold text-text-tertiary uppercase tracking-[0.12em] mb-2">
                        New Structures (overlay only)
                      </p>
                      <div className="space-y-2.5">
                        {localStructureIds.map((sId) => (
                          <LocalStructureCard
                            key={sId}
                            structureId={sId}
                            items={(board.containers[sId] ?? []).map((id) => board.itemsById[id])}
                            meta={board.structureMeta[sId] ?? { type: 'Custom' }}
                            exchange={exchange}
                            strategyTypes={strategyTypes}
                            onTypeChange={(t) => handleStructureTypeChange(sId, t)}
                            onRemove={() => handleRemoveStructure(sId)}
                            onRemoveItem={handleRemoveItem}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Saved structures from DB */}
                  {savedStructureInfos.length > 0 && (
                    <div>
                      <div className="space-y-2.5">
                        {savedStructureInfos.map((info) => {
                          const containerId = `saved:${info.id}`
                          const newLegs = (board.containers[containerId] ?? []).map(
                            (id) => board.itemsById[id],
                          )
                          return (
                            <SavedStructureCard
                              key={info.id}
                              structureId={containerId}
                              label={info.label}
                              existingLegs={info.position.legs}
                              newLegs={newLegs}
                              exchange={exchange}
                              onRemoveItem={handleRemoveItem}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {savedStructureInfos.length === 0 && localStructureIds.length === 0 && (
                    <p className="type-caption text-text-disabled italic text-center py-6">
                      No saved structures. Drop legs above to create one.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <DragOverlay>
              {activeDragId && board.itemsById[activeDragId] ? (
                <GhostChip legItem={board.itemsById[activeDragId]} exchange={exchange} />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : activeTab === 'no_import' ? (
          /* ──── No Import tab ──── */
          <div className="h-full flex flex-col gap-3 overflow-hidden">
            {noImportRows.length > 0 && (
              <p className="shrink-0 type-caption text-text-disabled">
                {(() => {
                  const counts: Record<string, number> = {}
                  for (const r of noImportRows) {
                    const reason = r.excludeReason ?? 'unknown'
                    counts[reason] = (counts[reason] ?? 0) + 1
                  }
                  const labels: Record<string, string> = {
                    not_option_trade: 'not an option trade',
                    no_instrument: 'no instrument',
                    no_side: 'no side',
                    no_amount: 'no amount',
                    no_price: 'zero-price',
                  }
                  return Object.entries(counts)
                    .map(([reason, count]) => `${count} ${labels[reason] ?? reason}`)
                    .join(', ')
                })()}
                {' — not imported.'}
              </p>
            )}
            {noImportRows.length === 0 ? (
              <p className="type-caption text-text-disabled italic">All CSV rows are option trades.</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto border border-border-default rounded-xl">
                <table className="min-w-full type-caption">
                  <thead className="bg-bg-surface-1 text-text-tertiary sticky top-0">
                    <tr>
                      <th className="p-2 text-left font-medium">Instrument</th>
                      <th className="p-2 text-left font-medium">Type</th>
                      <th className="p-2 text-left font-medium">Side</th>
                      <th className="p-2 text-left font-medium">Amount</th>
                      <th className="p-2 text-left font-medium">Price</th>
                      <th className="p-2 text-left font-medium">Reason</th>
                      <th className="p-2 text-left font-medium">Raw CSV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {noImportRows.map((r, i) => (
                      <tr key={i} className="border-t border-border-default text-text-secondary">
                        <td className="p-2">{r.instrument || '—'}</td>
                        <td className="p-2">{r.csvType || '—'}</td>
                        <td className="p-2 capitalize">{r.side || '—'}</td>
                        <td className="p-2">{r.amount || '—'}</td>
                        <td className="p-2">{r.price || '—'}</td>
                        <td className="p-2 text-text-tertiary">
                          {r.excludeReason ? ({ not_option_trade: 'Not option trade', no_instrument: 'No instrument', no_side: 'No side', no_amount: 'No amount', no_price: 'Zero price' } as Record<string, string>)[r.excludeReason] ?? r.excludeReason : '—'}
                        </td>
                        <td className="p-2">
                          {r.rawCsv ? (
                            <pre className="type-micro-sm text-text-tertiary whitespace-pre-wrap max-w-[360px] overflow-auto max-h-[80px]">{JSON.stringify(r.rawCsv, null, 2)}</pre>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === 'unprocessed' ? (
          /* ──── Unprocessed tab (user-driven, starts empty) ──── */
          <div className="h-full flex flex-col gap-3 overflow-hidden">
            {manuallyExcludedItems.length === 0 ? (
              <p className="type-caption text-text-disabled italic">No unprocessed rows. Use the eye-off icon on legs in the Open tab to mark them as unprocessed.</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto border border-border-default rounded-xl">
                <table className="min-w-full type-caption">
                  <thead className="bg-bg-surface-1 text-text-tertiary sticky top-0">
                    <tr>
                      <th className="p-2 text-left font-medium">Instrument</th>
                      <th className="p-2 text-left font-medium">Side</th>
                      <th className="p-2 text-left font-medium">Amount</th>
                      <th className="p-2 text-left font-medium">Price</th>
                      <th className="p-2 text-left font-medium">Trade ID</th>
                      <th className="p-2 text-left font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manuallyExcludedItems.map((item) => {
                      const r = item.row
                      return (
                        <tr key={item.id} className="border-t border-border-default text-text-secondary">
                          <td className="p-2">{r.instrument}</td>
                          <td className="p-2 capitalize">{r.side}</td>
                          <td className="p-2">{r.amount}</td>
                          <td className="p-2">{r.price}</td>
                          <td className="p-2">{r.trade_id || '—'}</td>
                          <td className="p-2">
                            <button
                              onClick={() => handleRestoreItem(item.id)}
                              className="flex items-center gap-1 text-text-tertiary hover:text-status-success transition-colors"
                              title="Restore to new legs"
                            >
                              <RotateCcw size={11} />
                              <span className="type-caption">Restore</span>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          /* ──── Processed tab (already in DB) ──── */
          <div className="h-full flex flex-col gap-3 overflow-hidden">
            {processedRows.length === 0 ? (
              <p className="type-caption text-text-disabled italic">No previously imported rows found in this CSV.</p>
            ) : (
              <>
                <p className="shrink-0 type-caption text-text-disabled">
                  {processedRows.length} row{processedRows.length !== 1 ? 's' : ''} already stored in database.
                </p>
                <div className="flex-1 min-h-0 overflow-auto border border-border-default rounded-xl">
                  <table className="min-w-full type-caption">
                    <thead className="bg-bg-surface-1 text-text-tertiary sticky top-0">
                      <tr>
                        <th className="p-2 text-left font-medium">Instrument</th>
                        <th className="p-2 text-left font-medium">Side</th>
                        <th className="p-2 text-left font-medium">Amount</th>
                        <th className="p-2 text-left font-medium">Price</th>
                        <th className="p-2 text-left font-medium">Trade ID</th>
                        <th className="p-2 text-left font-medium">Stored In</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processedRows.map((p, i) => (
                        <tr key={i} className="border-t border-border-default text-text-secondary">
                          <td className="p-2">{p.row.instrument}</td>
                          <td className="p-2 capitalize">{p.row.side}</td>
                          <td className="p-2">{p.row.amount}</td>
                          <td className="p-2">{p.row.price}</td>
                          <td className="p-2">{p.row.trade_id || '—'}</td>
                          <td className="p-2">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                              p.source === 'structure'
                                ? 'bg-status-success-bg text-status-success-text border border-status-success-border'
                                : 'bg-status-warning-bg text-status-warning-text border border-status-warning-border'
                            }`}>
                              {p.source === 'structure' ? 'Structure' : 'Unprocessed'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Reconcile Split Modal ── */}
      {pendingSplit && board.itemsById[pendingSplit.itemId] && (
        <SplitModal
          legItem={board.itemsById[pendingSplit.itemId]}
          targetLabel={pendingSplit.targetLabel}
          onConfirm={handleSplitConfirm}
          onCancel={() => setPendingSplit(null)}
        />
      )}

    </div>
  )
}
