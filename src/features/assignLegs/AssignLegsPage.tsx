import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Blocks } from 'lucide-react'
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
  type CollisionDetection,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TxnRow, Exchange, Position, parseInstrumentByExchange } from '../../utils'
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

const CONTAINER_BACKLOG = 'backlog'
const CONTAINER_NEW_STRUCTURE = 'new-structure'

/* ── premium helpers ── */

function calcLegPremium(row: TxnRow): number {
  const qty = Math.abs(row.amount ?? 0)
  const price = row.price ?? 0
  // sell = premium received (positive), buy = premium paid (negative)
  return price * qty * (row.side === 'sell' ? 1 : -1)
}

function formatPremium(value: number): string {
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs % 1 === 0) return String(Math.round(abs))
  // Use enough decimal places so at least 2 significant digits are visible
  // e.g. 0.00216 → "0.0022", 0.0129 → "0.0129", 1.23 → "1.23"
  if (abs >= 1) return abs.toFixed(2)
  const magnitude = Math.floor(Math.log10(abs))   // e.g. -3 for 0.00216
  const decimals = Math.max(2, -magnitude + 1)     // show 2 sig figs past leading zeros
  return abs.toFixed(decimals)
}

function PremiumBadge({ value }: { value: number }) {
  if (value === 0) return null
  // negative = received (credit) = green; positive = paid (debit) = red
  const isCredit = value < 0
  const color = isCredit
    ? 'bg-emerald-500 text-white border-emerald-600'
    : 'bg-rose-500 text-white border-rose-600'
  const sign = isCredit ? '+' : '-'
  return (
    <span className={`inline-flex items-center border rounded px-1 py-0 text-[10px] font-mono leading-tight ${color}`}>
      {sign}{formatPremium(value)}
    </span>
  )
}

/* ─────────────────────── types ─────────────────────── */

type SavedStructureInfo = {
  id: string
  label: string
  position: Position
}

/* ─────────────── compact draggable chip ─────────────── */

function LegChip({
  legItem,
  exchange,
  onRemove,
}: {
  legItem: LegItem
  exchange: Exchange
  onRemove?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: legItem.id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...(isDragging
      ? {
          transform: CSS.Transform.toString(transform) + ' scale(1.025)',
          boxShadow: 'inset 0px 0px 1px rgba(0,0,0,0.5), -1px 0 15px 0 rgba(34,33,81,0.01), 0px 15px 15px 0 rgba(34,33,81,0.25)',
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

  // Parse instrument parts for display
  const parsed = parseInstrumentByExchange(exchange, row.instrument)
  const qty = Math.abs(row.amount ?? 0)
  const qtyStr = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  const sign = row.side === 'sell' ? '-' : '+'
  const qtyPart = `${sign}${qtyStr}`
  const strikePart = parsed ? `${parsed.optionType}${parsed.strike}` : row.instrument
  const expiryPart = parsed?.expiryISO
    ? parsed.expiryISO.split('-').slice(1, 3).reverse().join('-')
    : ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-3 bg-black text-white rounded-[10px] px-[18px] py-[14px] cursor-grab active:cursor-grabbing touch-none select-none transition-transform"
    >
      <Blocks size={22} className="shrink-0 text-white/80" />
      <div className="flex flex-col gap-0.5 min-w-0">
        {/* Primary row — larger text */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-base font-black whitespace-nowrap leading-tight">
            {qtyPart}
          </span>
          <span className="text-base font-black whitespace-nowrap leading-tight">
            {strikePart}
          </span>
          {expiryPart && (
            <span className="text-base font-black whitespace-nowrap leading-tight">
              {expiryPart}
            </span>
          )}
        </div>
        {/* Secondary row — smaller text */}
        <div className="flex items-center gap-2 flex-wrap">
          <PremiumBadge value={premium} />
          {action && (
            <span
              className={`text-[10px] font-medium px-1 py-0 rounded border leading-tight ${
                action === 'open'
                  ? 'bg-blue-50/10 text-blue-300 border-blue-400/40'
                  : 'bg-white/10 text-white/50 border-white/20'
              }`}
            >
              {action}
            </span>
          )}
          {(datePart || timePart) && (
            <span className="text-[10px] text-white/40 whitespace-nowrap" title={ts}>
              {datePart} {timePart}
            </span>
          )}
        </div>
      </div>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-auto shrink-0 text-white/30 hover:text-rose-400 text-[11px] leading-none"
          title="Remove from structure"
        >
          ✕
        </button>
      )}
    </div>
  )
}

/* ─────────────── ghost chip while dragging ─────────────── */

function GhostChip({ legItem, exchange }: { legItem: LegItem; exchange: Exchange }) {
  return (
    <div
      className="flex items-center gap-3 bg-black text-white rounded-[10px] px-[18px] py-[14px] shadow-xl opacity-90 touch-none select-none"
      style={{ boxShadow: '-1px 0 15px 0 rgba(34,33,81,0.01), 0px 15px 15px 0 rgba(34,33,81,0.25)' }}
    >
      <Blocks size={22} className="shrink-0 text-white/80" />
      <span className="text-base font-black whitespace-nowrap leading-tight">
        {formatLegLabel(legItem.row, exchange)}
      </span>
    </div>
  )
}

/* ─────────────── droppable wrapper ─────────────── */

function Droppable({
  id,
  children,
  className,
}: {
  id: string
  children: React.ReactNode
  className?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`${className ?? ''} ${isOver ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
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
      className={`border-2 border-dashed rounded-lg p-3 transition-colors ${
        isOver
          ? 'border-blue-500 bg-blue-50'
          : items.length > 0
          ? 'border-emerald-300 bg-emerald-50/50'
          : 'border-slate-300 bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
            New Structure
          </p>
          <select
            value={structureType}
            onChange={(e) => onStructureTypeChange(e.target.value)}
            className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
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
              className="px-2 py-0.5 text-[11px] font-medium rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-400 transition-colors"
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
              className="px-2.5 py-0.5 text-xs font-medium rounded bg-slate-500 text-white hover:bg-slate-600 transition-colors"
            >
              Sort
            </button>
            <button
              onClick={onSave}
              className="px-2.5 py-0.5 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              Save
            </button>
          </div>
        )}
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-wrap gap-1.5 min-h-[32px]">
          {items.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic py-1">
              Drop legs here to create a new structure
            </p>
          ) : (
            items.map((item) => (
              <LegChip
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

function ExistingLegChip({ leg }: { leg: import('../../utils').Leg }) {
  const sign = leg.qtyNet >= 0 ? '+' : '-'
  const qty = Math.abs(leg.qtyNet)
  const qtyStr = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  return (
    <span className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-800 select-none">
      <span className="font-semibold">
        {sign}
        {qtyStr} / {leg.optionType}
        {leg.strike}
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
      className={`border rounded-lg px-3 py-2.5 transition-colors ${
        isOver ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 bg-slate-50/40'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-semibold text-slate-700 truncate flex-1" title={label}>
          {label}
        </p>
        {newLegsNetPremium !== null && <PremiumBadge value={newLegsNetPremium} />}
      </div>
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          {existingLegs.length > 0 ? (
            <div className="flex flex-col gap-1">
              {existingLegs.map((leg, i) => (
                <ExistingLegChip key={`existing-${i}`} leg={leg} />
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-slate-400 italic">No legs</p>
          )}
        </div>
        <SortableContext items={newLegs.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div
            className={`flex-1 min-w-0 border-2 border-dashed rounded-lg p-2 min-h-[32px] transition-colors ${
              isOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-100/80'
            }`}
          >
            {newLegs.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic text-center py-0.5">Drop legs to add</p>
            ) : (
              <div className="flex flex-col gap-1">
                {newLegs.map((item) => (
                  <LegChip
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
      className={`border rounded-lg p-3 transition-colors ${
        isOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-slate-700 truncate flex-1">
          {formatStructureLabel(items, meta.type)}
        </p>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {netPremium !== null && <PremiumBadge value={netPremium} />}
          <select
            value={meta.type}
            onChange={(e) => onTypeChange(e.target.value)}
            className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            {STRUCTURE_TYPES.map((st) => (
              <option key={st.code} value={st.code}>
                {st.code} – {st.label}
              </option>
            ))}
          </select>
          <button
            onClick={onRemove}
            className="text-[10px] text-rose-500 hover:text-rose-700"
            title="Delete structure"
          >
            ✕
          </button>
        </div>
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {items.length === 0 ? (
            <p className="text-[10px] text-slate-400 italic py-0.5">Drop legs here</p>
          ) : (
            items.map((item) => (
              <LegChip
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

export function AssignLegsPage({ onBack }: { onBack: () => void }) {
  const ctx = getAssignLegsContext()

  // If no context (e.g. navigated directly), go back
  useEffect(() => {
    if (!ctx) onBack()
  }, [ctx, onBack])

  if (!ctx) return null

  return <AssignLegsPageInner {...ctx} onBack={onBack} />
}

function AssignLegsPageInner({
  rows,
  excludedRows,
  exchange,
  savedStructures = [],
  onConfirm,
  onCancel,
  onBack,
}: {
  rows: TxnRow[]
  excludedRows: TxnRow[]
  exchange: Exchange
  savedStructures?: Position[]
  onConfirm: (rows: TxnRow[], unprocessedRows?: TxnRow[]) => void | Promise<void>
  onCancel: () => void
  onBack: () => void
}) {
  const [activeTab, setActiveTab] = useState<'included' | 'excluded'>('included')
  const [importing, setImporting] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [newStructureType, setNewStructureType] = useState<string>('IC')

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
    }

    const sorted = [...rows].sort((a, b) => {
      const ta = a.timestamp ?? ''
      const tb = b.timestamp ?? ''
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })

    sorted.forEach((row, idx) => {
      const id = generateLegId(row, idx)
      itemsById[id] = { id, row, included: true }
      containers[CONTAINER_BACKLOG].push(id)
    })

    for (const info of savedStructureInfos) {
      containers[`saved:${info.id}`] = []
    }

    return { itemsById, containers, structureOrder: [], structureMeta: {} }
  }, [rows, savedStructureInfos])

  const [board, setBoard] = useState(initialBoard)

  useEffect(() => {
    setBoard(initialBoard)
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
  const localStructureIds = board.structureOrder.filter((id) => board.containers[id])
  const backlogCount = backlogItems.length
  const newStructureCount = newStructureItems.length
  const canImport = backlogCount === 0 && newStructureCount === 0

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
      for (const itemId of itemIds) {
        const item = board.itemsById[itemId]
        if (item?.included) payload.push({ ...item.row, structureId })
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

    if (payload.length === 0) return

    try {
      setImporting(true)
      await onConfirm(payload)
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
    if (backlogCount > 0) parts.push(`${backlogCount} unassigned leg${backlogCount !== 1 ? 's' : ''}`)
    if (newStructureCount > 0)
      parts.push(`${newStructureCount} leg${newStructureCount !== 1 ? 's' : ''} in unsaved new structure`)
    return parts.length > 0 ? parts.join(', ') : null
  })()

  /* ═════════════════════ RENDER ═════════════════════ */

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* ── header ── */}
      <div className="shrink-0 flex items-center gap-3 px-6 pt-5 pb-3 border-b">
        <button
          onClick={handleCancel}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
          title="Back to dashboard"
        >
          <ArrowLeft size={18} />
        </button>
        <h3 className="text-lg font-semibold">Assign Legs to Structures</h3>
        <div className="ml-auto flex gap-2 text-sm">
          <button
            className={`px-3 py-1 rounded-lg border text-xs ${
              activeTab === 'included' ? 'bg-slate-900 text-white' : ''
            }`}
            onClick={() => setActiveTab('included')}
          >
            Included ({rows.length})
          </button>
          <button
            className={`px-3 py-1 rounded-lg border text-xs ${
              activeTab === 'excluded' ? 'bg-slate-900 text-white' : ''
            }`}
            onClick={() => setActiveTab('excluded')}
          >
            Excluded ({excludedRows.length})
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
            <div className="flex gap-8 h-full overflow-hidden">
              {/* ──── LEFT COLUMN: Backlog ──── */}
              <div className="flex-1 min-w-0 flex flex-col">
                <p className="shrink-0 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  New Legs ({backlogCount})
                </p>
                <Droppable
                  id={CONTAINER_BACKLOG}
                  className="flex-1 min-h-0 overflow-y-auto border border-slate-700 rounded-lg p-2 bg-slate-800 overscroll-contain"
                >
                  <SortableContext
                    items={backlogItems.map((i) => i.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="flex flex-col gap-1">
                      {backlogItems.length === 0 ? (
                        <p className="text-[11px] text-slate-500 italic text-center py-4">
                          All legs assigned
                        </p>
                      ) : (
                        backlogItems.map((item) => (
                          <LegChip key={item.id} legItem={item} exchange={exchange} />
                        ))
                      )}
                    </div>
                  </SortableContext>
                </Droppable>
              </div>

              {/* ──── RIGHT COLUMN: Structures ──── */}
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                {/* Pinned: New structure drop zone */}
                <div className="shrink-0">
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
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-4 bg-slate-800 border border-slate-700 rounded-lg p-3">
                  {/* Local (unsaved) structures */}
                  {localStructureIds.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">
                        New Structures (overlay only)
                      </p>
                      <div className="space-y-3">
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
                      <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">
                        Saved Structures
                      </p>
                      <div className="space-y-3">
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
                    <p className="text-xs text-slate-500 italic text-center py-6">
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
            <p className="shrink-0 text-sm text-slate-600">
              These rows were auto-excluded (non-option instruments). Review only.
            </p>
            {excludedRows.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No excluded rows.</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto border rounded-lg">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Instrument</th>
                      <th className="p-2 text-left">Side</th>
                      <th className="p-2 text-left">Amount</th>
                      <th className="p-2 text-left">Price</th>
                      <th className="p-2 text-left">Trade ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excludedRows.map((r, i) => (
                      <tr key={i} className="border-t opacity-70">
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
            )}
          </div>
        )}
      </div>

      {/* ── footer ── */}
      <div className="shrink-0 px-6 py-3 border-t flex items-center gap-3">
        {validationMsg && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1">
            {validationMsg}
          </span>
        )}
        <div className="ml-auto flex gap-3">
          <button onClick={handleCancel} className="px-4 py-2 rounded-xl border text-sm">
            Back
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport || importing}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
