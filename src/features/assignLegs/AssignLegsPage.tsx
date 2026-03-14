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
import { TxnRow, Exchange, Position, Leg, parseInstrumentByExchange, normalizeSecond } from '../../utils'
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
}: {
  legItem: LegItem
  exchange: Exchange
  onRemove?: () => void
  className?: string
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
          boxShadow: '0px 16px 24px rgba(0,0,0,0.5)',
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
      className={`flex flex-col bg-layer-card border border-zinc-700/60 rounded-xl px-3 py-2.5 cursor-grab active:cursor-grabbing touch-none select-none min-w-[160px] flex-1 max-w-[260px] transition-transform${extraClassName ? ' ' + extraClassName : ''}`}
    >
      {/* Header: icon + qty+strike + remove */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Blocks size={13} className="shrink-0 text-zinc-500" />
          <span className="type-caption font-bold text-zinc-100 truncate">
            {sign}{qtyStr} {strikePart}
          </span>
        </div>
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="shrink-0 text-zinc-600 hover:text-rose-400 type-caption leading-none ml-1 transition-colors"
            title="Remove from structure"
          >
            ✕
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-zinc-700/60 my-2" />

      {/* Expiry */}
      {expiryPart && (
        <div className="flex items-center gap-1.5 mb-1">
          <Calendar size={11} className="shrink-0 text-zinc-500" />
          <span className="type-caption text-zinc-400 whitespace-nowrap">{expiryPart}</span>
        </div>
      )}

      {/* Timestamp */}
      {(datePart || timePart) && (
        <div className="flex items-center gap-1.5 mb-2">
          <Clock size={11} className="shrink-0 text-zinc-500" />
          <span className="type-caption text-zinc-400 whitespace-nowrap" title={ts}>
            {datePart}{timePart ? ` ${timePart}` : ''}
          </span>
        </div>
      )}

      {/* Open/close chip */}
      {action && (
        <div className="mb-1">
          <span className="inline-flex items-center gap-1 bg-layer-chip rounded-md px-2 py-0.5 type-caption font-bold leading-tight text-zinc-100">
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
      className="flex flex-col bg-layer-chip border border-zinc-600 rounded-xl px-2.5 py-2 shadow-2xl opacity-90 touch-none select-none min-w-[148px] max-w-[240px]"
    >
      <div className="flex items-center gap-1.5">
        <Blocks size={12} className="shrink-0 text-zinc-400" />
        <span className="type-caption font-bold text-zinc-100 truncate">
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
}: {
  legItem: LegItem
  exchange: Exchange
  onExclude?: () => void
  className?: string
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
      className={`flex flex-col bg-layer-card border border-zinc-700/60 rounded-xl px-3 py-2.5 cursor-grab active:cursor-grabbing touch-none select-none min-w-[160px] flex-1 max-w-[260px]${extraClassName ? ' ' + extraClassName : ''}`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Blocks size={13} className="shrink-0 text-zinc-500" />
          <span className="type-caption font-bold text-zinc-100 truncate">
            {sign}{qtyStr} {strikePart}
          </span>
        </div>
        {onExclude && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onExclude() }}
            className="shrink-0 text-zinc-600 hover:text-amber-400 leading-none ml-1 transition-colors"
            title="Save as unprocessed"
          >
            <EyeOff size={11} />
          </button>
        )}
      </div>

      <div className="border-t border-zinc-700/60 my-2" />

      {expiryPart && (
        <div className="flex items-center gap-1.5 mb-1">
          <Calendar size={11} className="shrink-0 text-zinc-500" />
          <span className="type-caption text-zinc-400 whitespace-nowrap">{expiryPart}</span>
        </div>
      )}

      {(datePart || timePart) && (
        <div className="flex items-center gap-1.5 mb-2">
          <Clock size={11} className="shrink-0 text-zinc-500" />
          <span className="type-caption text-zinc-400 whitespace-nowrap" title={ts}>
            {datePart}{timePart ? ` ${timePart}` : ''}
          </span>
        </div>
      )}

      {action && (
        <div className="mb-1">
          <span className="inline-flex items-center gap-1 bg-layer-chip rounded-md px-2 py-0.5 type-caption font-bold leading-tight text-zinc-100">
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
      className={`${className ?? ''} ${isOver ? 'ring-2 ring-blue-500/50 ring-inset' : ''}`}
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
  onStructureTypeChange,
  onSave,
  onSort,
  onRemoveItem,
}: {
  items: LegItem[]
  exchange: Exchange
  structureType: string
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
          ? 'border-blue-500/60 bg-blue-500/5'
          : items.length > 0
          ? 'border-emerald-500/40 bg-emerald-500/5'
          : 'border-zinc-700 bg-zinc-900/50'
      }`}
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <select
            value={structureType}
            onChange={(e) => onStructureTypeChange(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-1.5 py-0.5 type-caption text-zinc-300 focus:outline-none focus:border-zinc-500"
          >
            {STRUCTURE_TYPES.map((st) => (
              <option key={st.code} value={st.code}>
                {st.code} – {st.label}
              </option>
            ))}
          </select>
          {items.length > 0 && (
            <button
              onClick={handleAutoDetect}
              className="px-2 py-0.5 type-caption font-medium rounded-lg border border-zinc-600 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:border-zinc-500 transition-colors"
              title="Auto-detect structure type from legs"
            >
              Auto
            </button>
          )}
          {netPremium !== null && <PremiumBadge value={netPremium} />}
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={onSort}
              className="px-2.5 py-0.5 type-caption font-medium rounded-lg bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
            >
              Sort
            </button>
            <button
              onClick={onSave}
              className="px-2.5 py-0.5 type-caption font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
            >
              Save
            </button>
          </div>
        )}
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-2 min-h-[36px] content-start">
          {items.length === 0 ? (
            <p className="type-caption text-zinc-600 italic py-1">
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
    <span className="inline-flex items-center gap-1 bg-zinc-700/50 border border-zinc-600/50 rounded-lg px-2 py-1 type-caption text-zinc-300 select-none">
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
        isOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-zinc-700 bg-zinc-800/50'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <p className="type-caption font-semibold text-zinc-400 truncate flex-1" title={label}>
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
            <p className="type-caption text-zinc-600 italic">No legs</p>
          )}
        </div>
        <SortableContext items={newLegs.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div
            className={`flex-1 min-w-0 border border-dashed rounded-xl p-2 min-h-[36px] transition-colors ${
              isOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-zinc-700 bg-zinc-900/50'
            }`}
          >
            {newLegs.length === 0 ? (
              <p className="type-caption text-zinc-600 italic text-center py-0.5">Drop legs to add</p>
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
  onTypeChange,
  onRemove,
  onRemoveItem,
}: {
  structureId: string
  items: LegItem[]
  meta: { type: string }
  exchange: Exchange
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
        isOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-zinc-700 bg-zinc-800/50'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="type-caption font-semibold text-zinc-400 truncate flex-1">
          {formatStructureLabel(items, meta.type)}
        </p>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {netPremium !== null && <PremiumBadge value={netPremium} />}
          <select
            value={meta.type}
            onChange={(e) => onTypeChange(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-1.5 py-0.5 type-caption text-zinc-300 focus:outline-none focus:border-zinc-500"
          >
            {STRUCTURE_TYPES.map((st) => (
              <option key={st.code} value={st.code}>
                {st.code} – {st.label}
              </option>
            ))}
          </select>
          <button
            onClick={onRemove}
            className="type-caption text-zinc-600 hover:text-rose-400 transition-colors"
            title="Delete structure"
          >
            ✕
          </button>
        </div>
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-2 min-h-[28px] content-start">
          {items.length === 0 ? (
            <p className="type-caption text-zinc-600 italic py-0.5">Drop legs here</p>
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

function AssignLegsPageInner({
  rows,
  excludedRows,
  exchange,
  savedStructures = [],
  onConfirm,
  onCancel,
  onBack,
  embedded,
}: {
  rows: TxnRow[]
  excludedRows: TxnRow[]
  exchange: Exchange
  savedStructures?: Position[]
  onConfirm: (rows: TxnRow[], unprocessedRows?: TxnRow[]) => void | Promise<void>
  onCancel: () => void
  onBack: () => void
  embedded?: boolean
}) {
  const [activeTab, setActiveTab] = useState<'included' | 'excluded'>('included')
  const [importing, setImporting] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [newStructureType, setNewStructureType] = useState<string>('IC')
  const [backlogPage, setBacklogPage] = useState(0)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

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

    // Count how many rows share each normalized-second timestamp.
    // For Deribit combo/spread orders every leg has the exact same timestamp,
    // so groups of 2-4 sharing a second are very likely a single structure.
    const tsCount = new Map<string, number>()
    for (const row of sorted) {
      const k = normalizeSecond(row.timestamp)
      if (k !== 'NO_TS') tsCount.set(k, (tsCount.get(k) ?? 0) + 1)
    }

    // Build a draft structure container for each combo group (2–4 shared legs).
    // Groups of 1 stay in backlog; groups > 4 are likely batch fills, not spreads.
    const tsToStructureId = new Map<string, string>()
    let autoSeq = 0
    for (const [tsKey, count] of tsCount.entries()) {
      if (count >= 2 && count <= 4) {
        const structId = `structure:${Date.now() + autoSeq++}`
        tsToStructureId.set(tsKey, structId)
        containers[structId] = []
        structureOrder.push(structId)
        structureMeta[structId] = { type: 'IC' } // refined below
      }
    }

    sorted.forEach((row, idx) => {
      const id = generateLegId(row, idx)
      itemsById[id] = { id, row, included: true }
      const tsKey = normalizeSecond(row.timestamp)
      const structId = tsToStructureId.get(tsKey)
      if (structId) {
        containers[structId].push(id)
      } else {
        containers[CONTAINER_BACKLOG].push(id)
      }
    })

    // Refine suggested structure type now that all legs are assigned.
    for (const [, structId] of tsToStructureId.entries()) {
      const legs = (containers[structId] ?? [])
        .map((id) => itemsById[id]?.row)
        .filter((r): r is TxnRow => Boolean(r))
      structureMeta[structId] = { type: suggestStructureType(legs) }
    }

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
    setActiveDragId(event.active.id as string)
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
    moveItem(activeId, targetContainerId)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)
    if (!over) return
    const activeId = active.id as string
    const overId = over.id as string
    const targetContainerId = containerIds.has(overId) ? overId : findContainer(overId, board)
    if (!targetContainerId) return
    moveItem(activeId, targetContainerId)
  }

  /* ── derived data ── */
  const backlogItems = (board.containers[CONTAINER_BACKLOG] ?? []).map((id) => board.itemsById[id])
  const newStructureItems = (board.containers[CONTAINER_NEW_STRUCTURE] ?? []).map(
    (id) => board.itemsById[id],
  )
  const manuallyExcludedItems = (board.containers[CONTAINER_EXCLUDED] ?? []).map(
    (id) => board.itemsById[id],
  )
  const localStructureIds = board.structureOrder.filter((id) => board.containers[id])
  const backlogCount = backlogItems.length
  const newStructureCount = newStructureItems.length
  const canImport = newStructureCount === 0

  /* ── backlog pagination ── */
  const totalBacklogPages = Math.max(1, Math.ceil(backlogCount / BACKLOG_PAGE_SIZE))
  const currentPage = Math.min(backlogPage, totalBacklogPages - 1)
  const pageStart = currentPage * BACKLOG_PAGE_SIZE
  const pageEnd = Math.min(pageStart + BACKLOG_PAGE_SIZE, backlogCount)
  const visibleBacklogItems = backlogItems.slice(pageStart, pageEnd)

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
  const validationMsg = (() => {
    const parts: string[] = []
    if (newStructureCount > 0)
      parts.push(`Drag the ${newStructureCount} leg${newStructureCount !== 1 ? 's' : ''} out of 'New Structure' or click Save Structure before importing`)
    return parts.length > 0 ? parts.join(', ') : null
  })()

  /* ═════════════════════ RENDER ═════════════════════ */

  return (
    <div className={embedded ? 'flex-1 min-h-0 flex flex-col bg-layer-page' : 'h-screen flex flex-col bg-layer-page'}>
      {/* ── header ── */}
      <div className="shrink-0 flex items-center gap-3 px-6 pt-5 pb-3 border-b border-zinc-800">
        {!embedded && (
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 transition-colors"
            title="Back to dashboard"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        {!embedded && (
          <h3 className="type-subhead font-semibold text-zinc-100 tracking-tight">Assign Legs to Structures</h3>
        )}
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 rounded-lg border type-caption font-bold uppercase tracking-[0.1em] transition-colors ${
              activeTab === 'included'
                ? 'bg-zinc-100 text-zinc-900 border-zinc-100'
                : 'border-zinc-700 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
            }`}
            onClick={() => setActiveTab('included')}
          >
            Included ({rows.length - manuallyExcludedItems.length})
          </button>
          <button
            className={`px-3 py-1 rounded-lg border type-caption font-bold uppercase tracking-[0.1em] transition-colors ${
              activeTab === 'excluded'
                ? 'bg-zinc-100 text-zinc-900 border-zinc-100'
                : 'border-zinc-700 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
            }`}
            onClick={() => setActiveTab('excluded')}
          >
            Unprocessed ({excludedRows.length + manuallyExcludedItems.length})
          </button>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* Cancel button with confirmation popover */}
          <div className="relative">
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="px-3 py-1 rounded-lg border border-zinc-700 text-zinc-400 type-caption font-bold hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            {showCancelConfirm && (
              <div className="absolute right-0 top-full mt-2 z-50 w-68 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4">
                <p className="type-body text-zinc-200 mb-4">You have unsaved changes. Would you cancel?</p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 type-caption font-bold hover:bg-zinc-800 transition-colors"
                  >
                    No
                  </button>
                  <button
                    onClick={() => { clearAssignLegsContext(); onCancel(); onBack(); }}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white type-caption font-bold hover:bg-red-500 transition-colors"
                  >
                    Yes
                  </button>
                </div>
              </div>
            )}
          </div>
          {validationMsg && (
            <span className="type-caption font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1">
              {validationMsg}
            </span>
          )}
          <button
            onClick={handleImport}
            disabled={!canImport || importing}
            title={
              importing
                ? 'Import in progress…'
                : !canImport && validationMsg
                ? validationMsg
                : undefined
            }
            className="px-3 py-1 rounded-lg bg-emerald-600 text-white type-caption font-bold hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>

      {/* ── body ── */}
      <div className="flex-1 min-h-0 overflow-hidden px-6 py-4">
        {activeTab === 'included' ? (
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
                  <p className="type-caption font-semibold text-zinc-500 uppercase tracking-[0.12em]">
                    New Legs ({backlogCount})
                  </p>
                  {backlogCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setBacklogPage(p => Math.max(0, p - 1))}
                        disabled={currentPage === 0}
                        className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors type-caption"
                      >
                        ‹
                      </button>
                      <span className="type-caption text-zinc-500 tabular-nums">
                        {pageStart + 1}–{pageEnd} of {backlogCount}
                      </span>
                      <button
                        onClick={() => setBacklogPage(p => Math.min(totalBacklogPages - 1, p + 1))}
                        disabled={currentPage >= totalBacklogPages - 1}
                        className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors type-caption"
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
                <Droppable
                  id={CONTAINER_BACKLOG}
                  className="flex-1 min-h-0 rounded-xl p-3 bg-layer-container border border-zinc-800"
                >
                  <div className="grid grid-cols-2 gap-2">
                    {backlogCount === 0 ? (
                      <p className="type-caption text-zinc-600 italic text-center py-4 col-span-2">
                        All legs assigned
                      </p>
                    ) : (
                      visibleBacklogItems.map((item) => (
                        <DraggableLegChip key={item.id} legItem={item} exchange={exchange} onExclude={() => handleExcludeItem(item.id)} className="w-full min-w-0 flex-none" />
                      ))
                    )}
                  </div>
                </Droppable>
              </div>

              {/* ──── RIGHT COLUMN: Structures ──── */}
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                {/* Pinned: New structure drop zone */}
                <div className="shrink-0">
                  <p className="type-caption font-semibold text-zinc-500 uppercase tracking-[0.12em] mb-2">
                    New Structure
                  </p>
                  <NewStructureDropZone
                    items={newStructureItems}
                    exchange={exchange}
                    structureType={newStructureType}
                    onStructureTypeChange={setNewStructureType}
                    onSave={handleSaveNewStructure}
                    onSort={handleSortNewStructure}
                    onRemoveItem={handleRemoveItem}
                  />
                </div>

                {/* Scrollable: structure cards */}
                <p className="shrink-0 type-caption font-semibold text-zinc-500 uppercase tracking-[0.12em] mb-2">
                  Saved Structures
                </p>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-3 bg-layer-container border border-zinc-800 rounded-xl p-3">
                  {/* Local (unsaved) structures */}
                  {localStructureIds.length > 0 && (
                    <div>
                      <p className="type-caption font-semibold text-zinc-500 uppercase tracking-[0.12em] mb-2">
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
                    <p className="type-caption text-zinc-600 italic text-center py-6">
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
        ) : (
          /* ──── Excluded tab ──── */
          <div className="h-full flex flex-col gap-3 overflow-hidden">
            {manuallyExcludedItems.length > 0 && (
              <div className="shrink-0">
                <p className="type-caption font-semibold text-zinc-500 uppercase tracking-[0.12em] mb-2">
                  Unprocessed ({manuallyExcludedItems.length})
                </p>
                <div className="border border-zinc-800 rounded-xl overflow-auto max-h-48">
                  <table className="min-w-full type-caption">
                    <thead className="bg-zinc-900 text-zinc-500 sticky top-0">
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
                          <tr key={item.id} className="border-t border-zinc-800 text-zinc-400">
                            <td className="p-2">{r.instrument}</td>
                            <td className="p-2 capitalize">{r.side}</td>
                            <td className="p-2">{r.amount}</td>
                            <td className="p-2">{r.price}</td>
                            <td className="p-2">{r.trade_id || '—'}</td>
                            <td className="p-2">
                              <button
                                onClick={() => handleRestoreItem(item.id)}
                                className="flex items-center gap-1 text-zinc-500 hover:text-emerald-400 transition-colors"
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
              </div>
            )}
            <div className="shrink-0">
              <p className="type-caption font-semibold text-zinc-500 uppercase tracking-[0.12em] mb-2">
                Auto-Excluded — Non-option rows ({excludedRows.length})
              </p>
              <p className="type-caption text-zinc-600 mb-2">Non-option instruments — not saved.</p>
            </div>
            {excludedRows.length === 0 && manuallyExcludedItems.length === 0 ? (
              <p className="type-caption text-zinc-600 italic">No unprocessed rows.</p>
            ) : excludedRows.length > 0 ? (
              <div className="flex-1 min-h-0 overflow-auto border border-zinc-800 rounded-xl">
                <table className="min-w-full type-caption">
                  <thead className="bg-zinc-900 text-zinc-500 sticky top-0">
                    <tr>
                      <th className="p-2 text-left font-medium">Instrument</th>
                      <th className="p-2 text-left font-medium">Side</th>
                      <th className="p-2 text-left font-medium">Amount</th>
                      <th className="p-2 text-left font-medium">Price</th>
                      <th className="p-2 text-left font-medium">Trade ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excludedRows.map((r, i) => (
                      <tr key={i} className="border-t border-zinc-800 text-zinc-400">
                        <td className="p-2">{r.instrument}</td>
                        <td className="p-2 capitalize">{r.side}</td>
                        <td className="p-2">{r.amount}</td>
                        <td className="p-2">{r.price}</td>
                        <td className="p-2">{r.trade_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
      </div>

    </div>
  )
}
